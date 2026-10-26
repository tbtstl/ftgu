import { useMemo } from 'react';
import {
  Button,
  Caption,
  Challenge,
  Checkbox,
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
  clamp,
  fmt,
  lessonHref,
  mix,
  pct,
  useScenario,
} from '../../../framework';
import { lineCapacity } from '../../../engines/gas/compression';
import { simulateYear, type YearDay } from '../../../engines/gas/market';
import { psia } from '../../../engines/gas/properties';
import { withdrawCapacity } from '../../../engines/gas/storage';
import { LNG_VALUE, OIL_SWITCH_VALUE, PROTECTED_VALUE, demandBlocks } from '../../../model/gas/demand';
import { cdd, gasDayLabel, hdd, weatherYear, type WeatherYear } from '../../../model/gas/weather';
import { BASINS, BAYPORT_LNG_FEEDGAS_BCFD, PIPELINE, STORAGE_SPECS, stationLineOf, type GasNodeId } from '../../../model/gas/world';
import { GasMap } from '../shared/GasMap';
import { XYChart } from '../shared/XYChart';
import { bcfd, gp } from '../shared/format';

// ---------------------------------------------------------------------------
// The storm: five days held at one temperature, laid over the typical winter of Lessons 4.2 and
// 5.1, with optional freeze-offs at both basins and a derated Northline while it lasts.

export type StormWhen = 'dec' | 'jan' | 'mar';
/** Day of the gas year each storm begins: December 5, January 29, March 1. */
export const STORM_START: Record<StormWhen, number> = { dec: 248, jan: 303, mar: 334 };
const WHEN_LABEL: Record<StormWhen, string> = { dec: 'Early December', jan: 'Late January', mar: 'Early March' };
/** The storm lasts five days; the window shows four days before it and twelve after. */
export const STORM_DAYS = 5;
export const STORM_LEAD = 4;
export const STORM_WINDOW = 21;
/** The weather the storm arrives in: the typical winter (seed 3) of Lessons 4.2 and 5.1. */
export const CRISIS_SEED = 3;
const NL = PIPELINE['calder-metro'];
/** Northline with the fourth compressor station of Lessons 1.4 and 4.3, Bcf/d. */
export const NORTHLINE_EXPANDED = 2.05;

export interface CrisisState {
  when: StormWhen;
  /** The storm's daily mean temperature at Metro, °F. */
  temp: number;
  /** Share of both basins' production lost to freeze-offs while it lasts. */
  freeze: number;
  /** Northline's capacity while it lasts, Bcf/d. */
  northline: number;
  /** Bayport's LNG terminal keeps loading cargoes whatever the price. */
  lngHold: boolean;
  /** Day of the window shown on the map (0–20). */
  day: number;
}

export const CRISIS_DEFAULTS: CrisisState = { when: 'jan', temp: 5, freeze: 0, northline: NL.capacityBcfd, lngHold: false, day: STORM_LEAD + 2 };

const round2 = (x: number) => Math.round(x * 100) / 100;
const baseWeather = weatherYear(CRISIS_SEED);

/** The typical winter with the storm laid over it: storm days held at `temp` (or colder, if they already were). */
export function stormWeather(when: StormWhen, temp: number): WeatherYear {
  const s = STORM_START[when];
  const t = baseWeather.temp.map((x, d) => (d >= s && d < s + STORM_DAYS ? Math.min(x, temp) : x));
  return { temp: t, normal: baseWeather.normal, hdd: t.map(hdd), cdd: t.map(cdd) };
}

export type CrisisSpec = Omit<CrisisState, 'day'>;

const runCache = new Map<string, YearDay[]>();
/** The market day by day through the storm's three weeks. Cached by its settings (about 1 ms a run). */
export function crisisRun(s: CrisisSpec): YearDay[] {
  const key = `${s.when}|${s.temp}|${round2(s.freeze)}|${round2(s.northline)}|${s.lngHold}`;
  let r = runCache.get(key);
  if (!r) {
    const start = STORM_START[s.when];
    const inStorm = (d: number) => d >= start && d < start + STORM_DAYS;
    r = simulateYear({
      weather: stormWeather(s.when, s.temp),
      startDay: start - STORM_LEAD,
      days: STORM_WINDOW,
      production: (d) => (inStorm(d) ? { ridgeback: BASINS[0].productionBcfd * (1 - s.freeze), sandhill: BASINS[1].productionBcfd * (1 - s.freeze) } : {}),
      capacity: (d) => (inStorm(d) ? { [NL.id]: s.northline } : undefined),
      demand: s.lngHold ? { lngValue: PROTECTED_VALUE } : undefined,
    });
    if (runCache.size > 400) runCache.clear();
    runCache.set(key, r);
  }
  return r;
}

export interface CrisisStats {
  /** Protected demand (homes) left unserved over the three weeks, Bcf. */
  rationedBcf: number;
  /** Days with any rationing. */
  rationDays: number;
  peakMetro: number;
  peakCalder: number;
  /** Average prices over the storm's five days, $/MMBtu. */
  stormMetro: number;
  stormCalder: number;
  /** LNG feed gas Bayport gave up during the storm, Bcf. */
  lngGivenUp: number;
  /** Working gas in Hollow Creek when the storm begins, Bcf. */
  hollowAtStorm: number;
}

/** What the storm did. */
export function crisisStats(s: CrisisSpec): CrisisStats {
  const r = crisisRun(s);
  const storm = r.slice(STORM_LEAD, STORM_LEAD + STORM_DAYS);
  const before = r[STORM_LEAD - 1];
  return {
    rationedBcf: r.reduce((a, d) => a + d.rationed, 0),
    rationDays: r.filter((d) => d.rationed > 1e-6).length,
    peakMetro: Math.max(...r.map((d) => d.price.metro)),
    peakCalder: Math.max(...r.map((d) => d.price.calder)),
    stormMetro: storm.reduce((a, d) => a + d.price.metro, 0) / STORM_DAYS,
    stormCalder: storm.reduce((a, d) => a + d.price.calder, 0) / STORM_DAYS,
    lngGivenUp: storm.reduce((a, d) => a + Math.max(0, BAYPORT_LNG_FEEDGAS_BCFD - d.sectors.lng), 0),
    hollowAtStorm: before.storage.hollowcreek,
  };
}

export type GiveWay = { oil: number; industry: number; lng: number; homes: number };

/**
 * Who gave way on a day: Metro's power plants burning oil instead of gas, industry shut down or
 * interrupted, LNG feed gas not loaded, and homes rationed — each the demand that would normally
 * be served (blocks worth more than $5) less what was, Bcf/d.
 */
export function giveWay(d: YearDay, s: CrisisSpec): GiveWay {
  const blocks = demandBlocks(d.tempF, s.lngHold ? { lngValue: PROTECTED_VALUE } : undefined);
  const cap = (pred: (id: string) => boolean) => blocks.filter((b) => pred(b.id ?? '')).reduce((a, b) => a + b.cap, 0);
  const powerCap = cap((id) => id === 'metro-power');
  const industryCap = cap((id) => id.includes('industry') || id.includes('interruptible'));
  // Power served includes cheap coal-switching blocks only when the price is low; on storm days it doesn't.
  const powerServed = d.price.metro > 5 + 1e-9 ? d.sectors.power : Math.min(d.sectors.power, powerCap);
  const industryServed = d.sectors.industry - Math.min(d.sectors.industry, d.price.bayport <= 5 + 1e-9 ? cap((id) => id === 'bayport-flexible') : 0);
  return {
    oil: Math.max(0, powerCap - powerServed),
    industry: Math.max(0, industryCap - industryServed),
    lng: Math.max(0, BAYPORT_LNG_FEEDGAS_BCFD - d.sectors.lng),
    homes: d.rationed,
  };
}

/** What Northline carries at its promised pressure with one of its three compressor stations out (Lesson 1.4), MMcf/d. */
export const NORTHLINE_STATION_OUT_MMCFD = lineCapacity({ ...stationLineOf(NL), stations: NL.stations - 1 }, psia(NL.minDeliveryPsig));
/** The same on the Northline slider's 0.05 Bcf/d steps, as in Lesson 5.1: 1.45 Bcf/d. */
export const NORTHLINE_STATION_OUT = round2(Math.round(NORTHLINE_STATION_OUT_MMCFD / 1000 / 0.05) * 0.05);

/** The storm of the prose's worst case: −5 °F, 30% frozen off, a compressor station out on Northline. */
export const WORST_STORM = { temp: -5, freeze: 0.3, northline: NORTHLINE_STATION_OUT };

/** The first challenge's storm: late January at −5 °F with 30% of production frozen off and cargoes giving way. */
export const NORTHLINE_CHALLENGE = { when: 'jan' as StormWhen, temp: -5, freeze: 0.3, lngHold: false };
export const NL_STEP = 0.05;
export const NL_MIN = 0.8;

/** Metro's shortfall on each storm day of the challenge's storm with a compressor station out, Bcf/d. */
export function challengeShortfalls(): number[] {
  return crisisRun({ ...NORTHLINE_CHALLENGE, northline: NORTHLINE_STATION_OUT })
    .slice(STORM_LEAD, STORM_LEAD + STORM_DAYS)
    .map((d) => d.rationed);
}

/** The least Northline capacity (on the slider's steps) at which the challenge's storm rations no one. */
export function northlineNeeded(): number {
  for (let k = Math.round(NL_MIN / NL_STEP); k <= Math.round(NORTHLINE_EXPANDED / NL_STEP); k++) {
    const nl = round2(k * NL_STEP);
    if (crisisStats({ ...NORTHLINE_CHALLENGE, northline: nl }).rationedBcf < 1e-6) return nl;
  }
  return Infinity;
}

/** The challenge: the challenge's storm with the least Northline that keeps every home supplied. */
export function stormNorthlineSolved(s: CrisisState): boolean {
  const same = s.when === NORTHLINE_CHALLENGE.when && s.temp === NORTHLINE_CHALLENGE.temp && Math.abs(s.freeze - NORTHLINE_CHALLENGE.freeze) < 1e-9 && s.lngHold === NORTHLINE_CHALLENGE.lngHold;
  return same && Math.abs(round2(s.northline) - northlineNeeded()) < 1e-9;
}

/** The second challenge: every defense in place, the warmest whole-degree March storm that still rations homes. */
export const EVERY_DEFENSE = { when: 'mar' as StormWhen, freeze: 0, northline: NORTHLINE_EXPANDED, lngHold: false };
export const TEMP_MIN = -15;
export const TEMP_MAX = 20;
export function warmestRationing(base: Omit<CrisisSpec, 'temp'> = EVERY_DEFENSE): number {
  for (let t = TEMP_MAX; t >= TEMP_MIN; t--) if (crisisStats({ ...base, temp: t }).rationedBcf > 1e-6) return t;
  return -Infinity;
}
export function marchDefenseSolved(s: CrisisState): boolean {
  const same = s.when === 'mar' && s.freeze === 0 && Math.abs(round2(s.northline) - NORTHLINE_EXPANDED) < 1e-9 && !s.lngHold;
  return same && s.temp === warmestRationing();
}

// ---------------------------------------------------------------------------
// Figures.

const LOG_TICKS = [2, 5, 10, 20, 50, 100];
const LOG_MIN = Math.log10(2);
const LOG_MAX = Math.log10(130);
const lg = (p: number) => Math.log10(clamp(p, 2, 130));
const METRO_COLOR = GRAPHIC.green;
const CALDER_COLOR = '#333';
const BAYPORT_COLOR = '#8a8a8a';

/** Node fill by price: pale under $5, warming through $15 to red at rationing. */
function priceTint(p: number): string {
  const t = clamp((Math.log10(p) - Math.log10(4)) / (Math.log10(100) - Math.log10(4)), 0, 1);
  return mix('#f7f5ef', '#e06a5a', t);
}

const money1 = (x: number) => gp(x, x >= 99.995 ? 0 : 2);

/** "30% frozen off, Northline 1.45, cargoes give way": the storm's settings that the defenses figure doesn't show. */
export function stormSettings(s: Pick<CrisisSpec, 'freeze' | 'northline' | 'lngHold'>): string {
  return `${s.freeze > 0 ? `${pct(s.freeze)} frozen off` : 'no freeze-offs'}, Northline ${fmt(s.northline, 2)}, cargoes ${s.lngHold ? 'keep loading' : 'give way'}`;
}

/** The map is drawn small so the figure stays short: its 600-unit viewBox, trimmed to 384 high, at most 440 px wide (about 280 px tall). */
export const MAP_HEIGHT = 384;
export const MAP_WIDTH = 440;

export default function Lesson() {
  const sc = useScenario('storm', CRISIS_DEFAULTS);
  const st = sc.state;
  const spec: CrisisSpec = { when: st.when, temp: st.temp, freeze: st.freeze, northline: st.northline, lngHold: st.lngHold };
  const run = crisisRun(spec);
  const stats = crisisStats(spec);
  const day = clamp(Math.round(st.day), 0, STORM_WINDOW - 1);
  const d = run[day];
  const start = STORM_START[st.when] - STORM_LEAD;
  const inStorm = day >= STORM_LEAD && day < STORM_LEAD + STORM_DAYS;
  const gw = giveWay(d, spec);
  const xs = run.map((_, i) => i);
  const label = (i: number) => gasDayLabel(start + i);

  const caps: Record<string, number> = Object.fromEntries(Object.values(PIPELINE).map((p) => [p.id, p.capacityBcfd]));
  if (inStorm) caps[NL.id] = st.northline;

  const parts: string[] = [];
  if (gw.oil > 0.005) parts.push(`Metro’s power plants burn oil in place of ${bcfd(gw.oil)} of gas`);
  if (gw.industry > 0.005) parts.push(`industry gives up ${bcfd(gw.industry)}`);
  if (gw.lng > 0.005) parts.push(`Bayport loads ${bcfd(gw.lng)} less LNG`);
  if (gw.homes > 0.005) parts.push(`${bcfd(gw.homes)} of homes and other protected customers go without`);
  const dayCaption = `${label(day)}, ${fmt(d.tempF)} °F at Metro${inStorm ? ', in the storm' : ''}: ${parts.length ? parts.join('; ') : 'every customer gets the gas it wants at these prices'}.`;

  // Figure 2: one change at a time.
  const rows = useMemo(() => {
    const base: CrisisSpec = spec;
    const list: Array<{ key: string; name: string; s: CrisisSpec }> = [
      { key: 'set', name: 'The storm as set', s: base },
      { key: 'wells', name: 'No freeze-offs', s: { ...base, freeze: 0 } },
      { key: 'nl', name: `Northline at ${fmt(NL.capacityBcfd, 1)}`, s: { ...base, northline: NL.capacityBcfd } },
      { key: 'nl4', name: `Northline at ${fmt(NORTHLINE_EXPANDED, 2)}`, s: { ...base, northline: NORTHLINE_EXPANDED } },
      base.lngHold
        ? { key: 'lng', name: 'Cargoes give way', s: { ...base, lngHold: false } }
        : { key: 'lng', name: 'Cargoes keep loading', s: { ...base, lngHold: true } },
      { key: 'all', name: 'Every defense', s: { ...base, freeze: 0, northline: NORTHLINE_EXPANDED, lngHold: false } },
    ];
    return list.map((r) => ({ ...r, stats: crisisStats(r.s) }));
  }, [st.when, st.temp, st.freeze, st.northline, st.lngHold]);
  const maxRation = Math.max(0.5, ...rows.map((r) => r.stats.rationedBcf));

  const solvedA = stormNorthlineSolved(st);
  const shortfalls = challengeShortfalls();
  const SHORT_FIRST = shortfalls[0];
  const SHORT_WORST = Math.max(...shortfalls);
  const needed = northlineNeeded();
  const solvedB = marchDefenseSolved(st);
  const warmest = warmestRationing();

  const sliders = (
    <>
      <Slider label="Storm at Metro" tone="teal" value={st.temp} min={TEMP_MIN} max={TEMP_MAX} onChange={(v) => sc.set({ temp: v })} display={`${fmt(st.temp)} °F for ${STORM_DAYS} days`} />
      <Slider label="Wells frozen off" tone="orange" value={st.freeze} min={0} max={0.5} step={0.05} onChange={(v) => sc.set({ freeze: v })} display={st.freeze > 0 ? `${pct(st.freeze)} of production` : 'none'} />
      <Slider label="Northline in the storm" tone="orange" value={st.northline} min={NL_MIN} max={NORTHLINE_EXPANDED} step={NL_STEP} onChange={(v) => sc.set({ northline: round2(v) })} display={bcfd(st.northline)} />
      <Checkbox label="Bayport’s LNG cargoes keep loading whatever the price" checked={st.lngHold} onChange={(v) => sc.set({ lngHold: v })} />
    </>
  );
  const whenSeg = (
    <Segmented
      label="When the storm arrives"
      value={st.when}
      onChange={(v) => sc.set({ when: v })}
      options={(['dec', 'jan', 'mar'] as StormWhen[]).map((w) => ({ value: w, label: WHEN_LABEL[w] }))}
    />
  );

  // Prose numbers (all from the engine).
  const P0 = crisisStats({ ...CRISIS_DEFAULTS });
  const P0run = crisisRun({ ...CRISIS_DEFAULTS });
  const P0storm = P0run[STORM_LEAD];
  const P0gw = giveWay(P0storm, CRISIS_DEFAULTS);
  const P0hollow = -P0storm.storageFlow.hollowcreek;
  const P0before = P0run[STORM_LEAD - 1].price.calder;
  const P0last = P0run[STORM_LEAD + STORM_DAYS - 1].price.calder;
  const FREEZE = { ...CRISIS_DEFAULTS, freeze: WORST_STORM.freeze };
  const P1 = crisisStats(FREEZE);
  const P1gw = giveWay(crisisRun(FREEZE)[STORM_LEAD], FREEZE);
  const OUTAGE = { ...FREEZE, northline: WORST_STORM.northline };
  const P2 = crisisStats(OUTAGE);
  const P2gw = giveWay(crisisRun(OUTAGE)[STORM_LEAD], OUTAGE);
  const WORST = { ...OUTAGE, temp: WORST_STORM.temp };
  const P3 = crisisStats(WORST);
  const P3gw = giveWay(crisisRun(WORST)[STORM_LEAD], WORST);
  const WORST_WELLS = crisisStats({ ...WORST, freeze: 0 });
  const WORST_LNG = crisisStats({ ...WORST, lngHold: true });
  const WORST_DEC = crisisStats({ ...WORST, when: 'dec' });
  const WORST_MAR = crisisStats({ ...WORST, when: 'mar' });
  const MAR_NL = crisisStats({ ...WORST, when: 'mar', northline: NL.capacityBcfd });

  return (
    <LessonPage id="gas/5.5">
      <P>
        Every price difference in this chapter has opened one constraint at a time. Northline fills and Metro’s price breaks away from Calder’s (
        <a href={lessonHref('gas/5.1')}>Lesson 5.1</a>). Storage fills and winter costs more than summer, and a field’s speed is worth money of its own (
        <a href={lessonHref('gas/5.2')}>Lesson 5.2</a>). A power plant’s heat rate turns a gas price into a power price (<a href={lessonHref('gas/5.3')}>Lesson 5.3</a>),
        and a ship’s voyage puts a gap between Calder and the rest of the world (<a href={lessonHref('gas/5.4')}>Lesson 5.4</a>). The most violent prices in gas come
        when several of these limits bind at once, and they do that on the coldest days of the year.
      </P>
      <P>
        Cold doesn’t only raise demand. It freezes the water that comes up with gas in wellheads and gathering lines, so production falls just when it’s needed
        most — <b>freeze-offs</b>, the industry calls them. It stretches compressor stations and their crews. And it arrives in the middle of a winter that has
        already drawn storage down, so the fields near the city deliver less than they could in December (<a href={lessonHref('gas/3.4')}>Lesson 3.4</a>). Each of
        those is a constraint we’ve met on its own. A winter storm is all of them together.
      </P>
      <P>
        In the next demonstration a five-day storm sweeps over the typical winter of Lessons 4.2 and 5.1, holding Metro’s daily mean temperature at the level you
        choose. Around it are four ordinary days before and twelve after. You decide how hard it hits: how much of the basins’ production freezes off while it lasts,
        whether a compressor failure cuts Northline’s capacity, and whether Bayport’s LNG terminal keeps loading cargoes whatever happens. The map shows the day
        you pick on the chart — each place’s <K c="price">price</K>, shaded as it climbs, and each pipeline’s flow — and the chart shows the prices at Metro, Calder
        and Bayport on a scale where each step up is a multiple, from $2 to $100. All prices are simulated:
      </P>

      <Figure name="Winter Supply Crisis" scenario={sc}>
        {whenSeg}
        <div style={{ maxWidth: MAP_WIDTH, margin: '0 auto' }}>
        <GasMap
          height={MAP_HEIGHT}
          ariaLabel={`The region on ${label(day)}${inStorm ? ', during the storm' : ''}: Metro ${money1(d.price.metro)}, Calder ${money1(d.price.calder)}, Bayport ${money1(d.price.bayport)} per MMBtu. Northline carries ${fmt(d.flow[NL.id] ?? 0, 2)} of ${fmt(caps[NL.id], 2)} Bcf/d.${d.rationed > 1e-6 ? ` ${fmt(d.rationed, 2)} Bcf/d of homes in Metro go without.` : ''}`}
          flows={d.flow}
          capacities={caps}
          nodeInfo={(id: GasNodeId) => {
            const p = d.price[id];
            const short = id === 'metro' && d.rationed > 1e-6;
            return { value: money1(p), sub: short ? `${fmt(d.rationed, 2)} short` : 'per MMBtu', fill: priceTint(p) };
          }}
          pipeLabel={(id) => (id === NL.id && inStorm && st.northline < NL.capacityBcfd - 1e-9 ? `${fmt(d.flow[id] ?? 0, 2)} / ${fmt(st.northline, 2)} derated` : undefined)}
          storage={(id) => {
            const f = id === 'saltflat' ? d.storageFlow.saltflat : d.storageFlow.hollowcreek;
            const inv = id === 'saltflat' ? d.storage.saltflat : d.storage.hollowcreek;
            return `${fmt(inv)} Bcf left · ${f < -1e-6 ? `out ${fmt(-f, 2)}` : f > 1e-6 ? `in ${fmt(f, 2)}` : 'idle'}`;
          }}
        />
        </div>
        <XYChart
          xDomain={[0, STORM_WINDOW - 1]}
          yDomain={[LOG_MIN, LOG_MAX]}
          yTicks={LOG_TICKS.map(Math.log10)}
          yFormat={(v) => `$${fmt(10 ** v)}`}
          xTicks={[0, 4, 8, 12, 16, 20]}
          xFormat={(v) => label(v)}
          yLabel="Price, $/MMBtu (each step a multiple)"
          height={165}
          bands={[{ from: STORM_LEAD - 0.5, to: STORM_LEAD + STORM_DAYS - 0.5, color: 'rgba(42, 157, 144, 0.10)', label: 'storm' }]}
          series={[
            { xs, ys: run.map((x) => lg(x.price.bayport)), color: BAYPORT_COLOR, width: 1.5, dash: '5 4' },
            { xs, ys: run.map((x) => lg(x.price.calder)), color: CALDER_COLOR, width: 2 },
            { xs, ys: run.map((x) => lg(x.price.metro)), color: METRO_COLOR, width: 2.5 },
          ]}
          hLines={[
            { at: lg(OIL_SWITCH_VALUE), color: '#b9b4a6', dash: '2 4', width: 1, label: 'oil switching', labelAt: 'start' },
            { at: lg(PROTECTED_VALUE), color: '#e0a39a', dash: '2 4', width: 1, label: 'rationing', labelAt: 'start' },
          ]}
          markers={[{ x: day, y: lg(d.price.metro), color: METRO_COLOR, r: 5 }]}
          cursor={day}
          onScrub={(v) => sc.set({ day: Math.round(v) })}
          scrubLabel="Day shown on the map"
          ariaLabel={`Prices over three weeks around the storm: Metro peaks at ${money1(stats.peakMetro)}, Calder at ${money1(stats.peakCalder)}. ${stats.rationedBcf > 1e-6 ? `${fmt(stats.rationedBcf, 2)} Bcf of homes go without over ${stats.rationDays} days.` : 'No homes go without.'}`}
        />
        <Legend
          items={[
            { label: 'Metro', color: METRO_COLOR, kind: 'line' },
            { label: 'Calder Hub', color: CALDER_COLOR, kind: 'line' },
            { label: 'Bayport', color: BAYPORT_COLOR, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'Metro’s peak', value: money1(stats.peakMetro), tone: 'green' },
            { label: 'Calder’s peak', value: money1(stats.peakCalder), tone: 'green' },
            { label: 'LNG not loaded', value: `${fmt(stats.lngGivenUp, 2)} Bcf` },
            { label: 'homes without gas', value: stats.rationedBcf > 1e-6 ? `${fmt(stats.rationedBcf, 2)} Bcf` : 'none', tone: stats.rationedBcf > 1e-6 ? 'red' : 'ink' },
          ]}
        />
        {sliders}
        <Caption>{dayCaption}</Caption>
      </Figure>

      <P>
        Start with the cold alone: a late-January storm at {fmt(CRISIS_DEFAULTS.temp)} °F, with the wells, Northline and the LNG terminal all working. On the first
        storm day Metro wants more gas than its supplies can bring: Northline and the Valley Line are full, and Hollow Creek is withdrawing all its wells can,{' '}
        {bcfd(P0hollow)}. So Metro’s price climbs the demand curve of <a href={lessonHref('gas/4.1')}>Lesson 4.1</a> to {money1(P0.peakMetro)}, the price at
        which the city’s gas-fired power plants would rather burn oil. They do, freeing {bcfd(P0gw.oil)} of gas for furnaces, and with interruptible industry
        giving up another {bcfd(P0gw.industry)}, every home stays warm. Calder feels the storm only slowly. From {money1(P0before)} the day before, it creeps to{' '}
        {money1(P0last)} by the storm’s last day, as the storage operators, drawing their fields down faster than planned, value what’s left more (
        <a href={lessonHref('gas/4.4')}>Lesson 4.4</a>). A spike at the city gate over a hub that barely moves is the basis of{' '}
        <a href={lessonHref('gas/5.1')}>Lesson 5.1</a> at its most extreme.
      </P>

      <H2>When the wells freeze</H2>
      <P>
        Now let the storm freeze off {pct(FREEZE.freeze)} of both basins’ production. The hub feels it at once: Calder rises to {money1(P1.peakCalder)}, until
        something there gives way. What gives way is Bayport’s LNG terminal. Its feed gas is worth {money1(LNG_VALUE)} at Bayport, the value{' '}
        <a href={lessonHref('gas/4.1')}>Lesson 4.1</a> gave it — in the terms of <a href={lessonHref('gas/5.4')}>Lesson 5.4</a>, a cap of{' '}
        {money1(LNG_VALUE - PIPELINE['calder-bayport'].variableCost)} at Calder — so at that price the terminal loads less: {bcfd(P1gw.lng)} less on the first storm
        day, {fmt(P1.lngGivenUp, 2)} Bcf over the storm. Exports are the region’s release valve, as Lesson 5.4 found. Metro, oddly, is no worse off. Its limit is the pipes and the
        storage field that feed it, not the gas at the hub, and Metro’s price was already set by the oil burners.
      </P>
      <P>
        Then take one of Northline’s three compressor stations out for the storm. The two left can push about {fmt(NORTHLINE_STATION_OUT_MMCFD)} MMcf/d through it (
        <a href={lessonHref('gas/1.4')}>Lesson 1.4</a>), so Northline drops to {bcfd(OUTAGE.northline)}, as in{' '}
        <a href={lessonHref('gas/5.1')}>Lesson 5.1</a>. Less gas reaches the city, every power plant that
        can burn oil does — {bcfd(P2gw.oil)} of gas freed — and the next buyers to give way are Metro’s factories: the price reaches {money1(P2.peakMetro)}. Finally make the storm colder, {fmt(WORST.temp)} °F.
        Now there is no one left to give way but homes. Metro’s price hits the {money1(PROTECTED_VALUE)} that stands for rationing in our model, and{' '}
        {bcfd(P3gw.homes)} of protected demand goes without on the first day — {fmt(P3.rationedBcf, 2)} Bcf over {P3.rationDays} days. In real systems the
        utility would cut customers off in an order its regulators have set, and restoring service to a house whose pilot light went out takes a visit from a
        technician, so outages last longer than the cold.
      </P>

      <Challenge
        id="a"
        figure="Winter Supply Crisis"
        question={`A late-January storm at ${fmt(NORTHLINE_CHALLENGE.temp)} °F freezes off ${pct(NORTHLINE_CHALLENGE.freeze)} of production, and Bayport’s cargoes give way as usual. What’s the least Northline capacity during the storm, to the nearest 0.05 Bcf/d, at which no home in Metro goes without? Estimate first: with Northline at ${bcfd(WORST_STORM.northline)}, drag across the chart through the storm’s ${STORM_DAYS} days and read on the map how short Metro is. How much more pipe would cover the worst day? Then check.`}
        solved={solvedA}
        status={
          st.when !== NORTHLINE_CHALLENGE.when || st.temp !== NORTHLINE_CHALLENGE.temp || Math.abs(st.freeze - NORTHLINE_CHALLENGE.freeze) > 1e-9 || st.lngHold
            ? `Set the storm first: late January, ${fmt(NORTHLINE_CHALLENGE.temp)} °F, ${pct(NORTHLINE_CHALLENGE.freeze)} frozen off, cargoes giving way.`
            : stats.rationedBcf > 1e-6
              ? `At ${bcfd(st.northline)}, ${fmt(stats.rationedBcf, 2)} Bcf of homes go without.`
              : `At ${bcfd(st.northline)} no one is rationed. Would less Northline do?`
        }
        success={`Solved: ${bcfd(needed)}. At ${bcfd(WORST_STORM.northline)}, Metro was ${fmt(SHORT_FIRST, 2)} Bcf/d short on the storm’s first day and ${fmt(SHORT_WORST, 2)} on its last, as Hollow Creek’s wells delivered a little less each day; ${fmt(WORST_STORM.northline, 2)} + ${fmt(SHORT_WORST, 2)} = ${fmt(WORST_STORM.northline + SHORT_WORST, 2)}, so ${bcfd(round2(needed - NL_STEP))} still leaves ${fmt(crisisStats({ ...NORTHLINE_CHALLENGE, northline: round2(needed - NL_STEP) }).rationedBcf, 2)} Bcf of homes without gas. Every 0.05 Bcf/d of Northline the storm takes away is gas Metro must find elsewhere, and in that storm there is nowhere else: Hollow Creek is already delivering all its wells can, and the power plants and factories have already given way. The freeze-offs don’t enter into it — the city’s limit is its pipes.`}
      />

      <H2>Defenses</H2>
      <P>
        A region can’t choose its weather, but it can choose how much of each defense to have. The next demonstration runs the storm you set in{' '}
        <FigRef to="Winter Supply Crisis">the first demonstration</FigRef> again with one thing changed at a time — winterized wells, a repaired or expanded
        Northline, LNG cargoes that do or don’t give way — and compares how many homes go without and what gas costs during the storm. Press{' '}
        <i>Worst storm</i> to set up the storm that rationed homes in late January, or <i>Every defense</i> to give the region all of them at once, and choose when
        the storm arrives:
      </P>

      <Figure
        name="Winter Supply Crisis · defenses"
        scenario={sc}
        actions={
          <>
            <Button
              onClick={() => sc.set({ temp: WORST_STORM.temp, freeze: WORST_STORM.freeze, northline: WORST_STORM.northline, lngHold: false })}
              label={`Set up the worst storm: ${fmt(WORST_STORM.temp)} °F, ${pct(WORST_STORM.freeze)} frozen off, Northline at ${bcfd(WORST_STORM.northline)}`}
            >
              Worst storm
            </Button>
            <Button
              onClick={() => sc.set({ freeze: EVERY_DEFENSE.freeze, northline: EVERY_DEFENSE.northline, lngHold: EVERY_DEFENSE.lngHold })}
              label={`Put every defense in place: no freeze-offs, Northline at ${bcfd(EVERY_DEFENSE.northline)}, cargoes give way`}
            >
              Every defense
            </Button>
          </>
        }
      >
        {whenSeg}
        <DataTable
          caption="The storm with one thing changed at a time"
          rows={rows}
          rowKey={(r) => r.key}
          rowClass={(r) => (r.key === 'set' ? 'hl' : '')}
          columns={[
            {
              label: 'Change',
              cell: (r) =>
                r.key === 'set' ? (
                  <span style={{ whiteSpace: 'normal' }}>
                    {r.name}
                    <br />
                    <span style={{ fontSize: 12.5, fontWeight: 400, color: TEXT.gray }}>{stormSettings(r.s)}</span>
                  </span>
                ) : (
                  r.name
                ),
            },
            {
              label: 'Homes go without',
              cell: (r) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span
                    aria-hidden="true"
                    style={{ display: 'inline-block', height: 8, width: `${Math.round((60 * r.stats.rationedBcf) / maxRation)}px`, background: GRAPHIC.red, borderRadius: 2 }}
                  />
                  {r.stats.rationedBcf > 1e-6 ? `${fmt(r.stats.rationedBcf, 2)} Bcf` : 'none'}
                </span>
              ),
              align: 'right',
            },
            { label: 'Metro', cell: (r) => money1(r.stats.stormMetro), align: 'right' },
            { label: 'Calder', cell: (r) => money1(r.stats.stormCalder), align: 'right' },
          ]}
        />
        <Readouts
          items={[
            { label: 'Hollow Creek when the storm begins', value: `${fmt(stats.hollowAtStorm)} Bcf of 120`, tone: 'gold' },
            { label: 'what its wells can deliver then', value: bcfd(withdrawCapacity(STORAGE_SPECS.hollowcreek, stats.hollowAtStorm)), tone: 'gold' },
          ]}
        />
        <Slider label="Storm temperature at Metro" tone="teal" value={st.temp} min={TEMP_MIN} max={TEMP_MAX} onChange={(v) => sc.set({ temp: v })} display={`${fmt(st.temp)} °F`} />
        <Caption>
          {`Metro and Calder: average prices over the storm’s ${STORM_DAYS} days, $/MMBtu. The first row is the storm as you set it in the first demonstration, at the temperature and timing chosen here; “Every defense” means no freeze-offs, Northline at ${fmt(NORTHLINE_EXPANDED, 2)} with its fourth station, and cargoes that give way.`}
        </Caption>
      </Figure>

      <P>
        Take the worst late-January storm, at {fmt(WORST.temp)} °F with freeze-offs and a broken compressor. Winterizing the wells leaves Metro exactly as short —{' '}
        {fmt(WORST_WELLS.rationedBcf, 2)} Bcf — because, as the challenge showed, the city’s limit is the pipe and not the gas behind it; the wells protect Calder,
        Bayport and the export cargoes instead. Repairing Northline ends the rationing. And forcing Bayport to keep loading LNG makes things worse, not better. The
        cargoes take gas the region needs, Bayport’s factories shut down, the shortage spreads back up Northline until even Calder trades at{' '}
        {money1(WORST_LNG.peakCalder)}, and {fmt(WORST_LNG.rationedBcf, 2)} Bcf of homes go without. A buyer that can give way when gas is scarce is worth as much
        to a region as a supplier.
      </P>
      <P>
        Now move the storm.{' '}
        {WORST_DEC.rationedBcf < 1e-6
          ? 'In early December the same storm rations no one at all'
          : `The same storm in early December rations ${fmt(WORST_DEC.rationedBcf, 2)} Bcf`}
        ; in early March it rations {fmt(WORST_MAR.rationedBcf, 2)} Bcf. Hollow Creek is the difference: it enters a December storm nearly full, and a March storm with what a whole winter has left it, so its wells deliver less, as{' '}
        <a href={lessonHref('gas/3.4')}>Lesson 3.4</a> showed. Even with Northline repaired, the March storm still leaves {fmt(MAR_NL.rationedBcf, 2)} Bcf of homes
        without gas. The most dangerous cold isn’t the coldest; it’s the cold that comes late.
      </P>

      <Challenge
        id="b"
        figure="Winter Supply Crisis · defenses"
        question="Put every defense in place — no freeze-offs, Northline expanded with its fourth station, LNG cargoes giving way — and send the storm in early March. What’s the warmest whole-degree storm temperature at which homes in Metro still go without?"
        solved={solvedB}
        status={
          st.when !== 'mar' || st.freeze !== 0 || Math.abs(st.northline - NORTHLINE_EXPANDED) > 1e-9 || st.lngHold
            ? `Press Every defense (no freeze-offs, Northline at ${fmt(NORTHLINE_EXPANDED, 2)} Bcf/d, cargoes giving way) and choose early March.`
            : stats.rationedBcf > 1e-6
              ? `At ${fmt(st.temp)} °F, ${fmt(stats.rationedBcf, 2)} Bcf of homes still go without. Could a warmer storm do it too?`
              : `At ${fmt(st.temp)} °F every home is supplied.`
        }
        success={`Solved: ${fmt(warmest)} °F. A degree warmer and every home is supplied; at ${fmt(warmest)} °F, ${fmt(crisisStats({ ...EVERY_DEFENSE, temp: warmest }).rationedBcf, 2)} Bcf go without. With the wells winterized and Northline expanded, what’s left is Hollow Creek, which can deliver only what its pressure allows by March. The last defense against a late storm is gas stored, and kept, close to the city.`}
      />

      <P>
        Real storms have followed this pattern. In February 2021, Winter Storm Uri froze wells and equipment across Texas and its neighboring states. Gas production
        there fell sharply in the same days that demand for heat and power soared, power plants that needed gas couldn’t get it, and some regional spot prices rose to
        many times their usual level for several days. No single failure caused it; several limits bound at once.
      </P>

      <H2>Where price differences come from</H2>
      <P>
        This chapter asked where economically meaningful price differences originate. Each one we found traces back to a physical limit that binds: a full pipeline (
        <a href={lessonHref('gas/5.1')}>Lesson 5.1</a>), full storage and a field’s speed (<a href={lessonHref('gas/5.2')}>Lesson 5.2</a>), a plant’s heat rate (
        <a href={lessonHref('gas/5.3')}>Lesson 5.3</a>), a ship’s voyage and a fee sunk once it’s signed (<a href={lessonHref('gas/5.4')}>Lesson 5.4</a>) and, from
        one day to the next, a storage field’s deliverability running out, as in this lesson’s late storms. When several limits bind together, the difference stops being set by any cost at all and is set by the value of the last use given up: oil-fired power,
        idled factories, cancelled cargoes and, last of all, cold homes.
      </P>
      <P>
        Those differences are where money is made and lost. A trader who can see a constraint coming — a cold winter draining storage, a basin outgrowing its
        pipes, a pipeline expansion about to erase a basis — before the market prices it might profit from it. Whether understanding the physical system really is
        enough to trade on is the question of <a href={lessonHref('gas/6.1')}>Chapter 6</a>, starting with forecasting the supply, demand and storage behind the prices.
      </P>
    </LessonPage>
  );
}
