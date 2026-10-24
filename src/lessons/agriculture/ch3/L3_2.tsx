import { useMemo } from 'react';
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
  Segmented,
  Slider,
  fmt,
  lessonHref,
  useScenario,
} from '../../../framework';
import { STAGES, simulateSeason, type SeasonResult } from '../../../engines/agriculture/crop';
import { REFERENCE_YEAR, simulatedYear, withEvents, type WeatherEvent } from '../../../model/agriculture/climate';
import { DISTRICT, dateLabel, dayOf, type Crop } from '../../../model/agriculture/region';
import { DayChart, type DayBand } from '../shared/DayChart';
import { buAc } from '../shared/format';
import { CROP_LINE } from '../shared/tones';

const PRAIRIE = DISTRICT.prairie;
const WEATHER = simulatedYear(REFERENCE_YEAR, 'prairie');
type EventKind = 'drought' | 'heat' | 'frost';

export interface LabState {
  crop: Crop;
  kind: EventKind;
  date: number;
  days: number;
  degrees: number;
  low: number;
}

const RANGE: Record<Crop, [number, number]> = { corn: [dayOf(5, 15), dayOf(10, 1)], wheat: [dayOf(3, 15), dayOf(6, 25)] };

function eventOf(st: LabState, date = st.date): WeatherEvent {
  if (st.kind === 'drought') return { kind: 'drought', start: date, days: st.days };
  if (st.kind === 'heat') return { kind: 'heat', start: date, days: 5, degrees: st.degrees };
  return { kind: 'frost', day: date, low: st.low };
}

function grow(crop: Crop, events: WeatherEvent[]): SeasonResult {
  const w = withEvents(WEATHER, events);
  return crop === 'corn'
    ? simulateSeason(w, { crop, plantDay: dayOf(5, 1), maturityGdd: PRAIRIE.hybridGdd, pawIn: PRAIRIE.pawIn, startWater: PRAIRIE.springWater })
    : simulateSeason(w, { crop, pawIn: PRAIRIE.pawIn, startWater: PRAIRIE.springWater });
}

const BASE: Record<Crop, SeasonResult> = { corn: grow('corn', []), wheat: grow('wheat', []) };

/** Yield for the event on every date in the crop's range (every other day), cached by settings. */
const sweepCache = new Map<string, { days: number[]; yields: number[] }>();
export function sweep(st: LabState): { days: number[]; yields: number[] } {
  const k = JSON.stringify([st.crop, st.kind, st.days, st.degrees, st.low]);
  let s = sweepCache.get(k);
  if (!s) {
    const [a, b] = RANGE[st.crop];
    const days: number[] = [];
    const yields: number[] = [];
    for (let d = a; d <= b; d += 2) {
      days.push(d);
      yields.push(grow(st.crop, [eventOf(st, d)]).yield);
    }
    s = { days, yields };
    sweepCache.set(k, s);
  }
  return s;
}

/** Challenge 1: the earliest date on which a −4 °C freeze costs the wheat more than half its yield. */
export function freezeSolved(st: LabState): boolean {
  if (st.crop !== 'wheat' || st.kind !== 'frost' || st.low !== -4) return false;
  const half = 0.5 * BASE.wheat.yield;
  const y = (d: number) => grow('wheat', [{ kind: 'frost', day: d, low: -4 }]).yield;
  return y(st.date) < half && y(st.date - 1) >= half;
}

/** Challenge 2: the start date (within a bushel) on which a three-week dry spell costs the corn the most. */
export function droughtSolved(st: LabState): boolean {
  if (st.crop !== 'corn' || st.kind !== 'drought' || st.days !== 21) return false;
  if (worstDrought === null) {
    worstDrought = Infinity;
    for (let d = RANGE.corn[0]; d <= RANGE.corn[1]; d++) worstDrought = Math.min(worstDrought, grow('corn', [{ kind: 'drought', start: d, days: 21 }]).yield);
  }
  return grow('corn', [eventOf(st)]).yield <= worstDrought + 1;
}
let worstDrought: number | null = null;

/** Shaded stage bands for a crop's season: leaves, flowering, grain fill. */
function stageBands(r: SeasonResult): DayBand[] {
  const at = (code: string) => r.stageDays[STAGES[r.crop].findIndex((s) => s.code === code)];
  if (r.crop === 'corn') {
    return [
      { from: at('VE'), to: at('VT'), color: 'rgba(109, 156, 55, .10)', label: 'leaves' },
      { from: at('VT'), to: at('R2'), color: 'rgba(201, 154, 30, .22)', label: 'silking' },
      { from: at('R2'), to: r.maturityDay, color: 'rgba(201, 154, 30, .10)', label: 'grain fill' },
    ];
  }
  return [
    { from: at('J'), to: at('B'), color: 'rgba(109, 156, 55, .10)', label: 'stems' },
    { from: at('B'), to: at('M'), color: 'rgba(208, 112, 42, .22)', label: 'heads' },
    { from: at('M'), to: r.maturityDay, color: 'rgba(208, 112, 42, .10)', label: 'fill' },
  ];
}

function stageOn(r: SeasonResult, day: number): string {
  const e = r.days.find((x) => x.day === day);
  if (!e) return day < r.start ? 'not yet planted' : 'mature';
  if (e.stage < 0) return 'just planted';
  const st = STAGES[r.crop][e.stage];
  return `${st.code}, ${st.name}`;
}

export default function Lesson() {
  const s = useScenario('lab', { crop: 'corn' as Crop, kind: 'drought' as EventKind, date: dayOf(7, 10), days: 21, degrees: 6, low: -3 } as LabState);
  const st = s.state;
  const sw = useMemo(() => sweep(st), [st.crop, st.kind, st.days, st.degrees, st.low]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = useMemo(() => grow(st.crop, [eventOf(st)]), [st]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = BASE[st.crop];
  const loss = 1 - run.yield / base.yield;
  const solved1 = useMemo(() => freezeSolved(st), [st]);
  const solved2 = useMemo(() => droughtSolved(st), [st]);
  const [a, b] = RANGE[st.crop];
  const date = Math.max(a, Math.min(b, st.date));
  const eventBand: DayBand = st.kind === 'frost' ? { from: date, to: date + 1, color: 'rgba(69, 144, 206, .5)' } : { from: date, to: date + (st.kind === 'drought' ? st.days : 5), color: st.kind === 'drought' ? 'rgba(231, 91, 85, .2)' : 'rgba(231, 91, 85, .3)' };
  const severity = st.kind === 'drought' ? `${st.days} days without rain` : st.kind === 'heat' ? `five days ${st.degrees} °C hotter` : `a ${fmt(st.low)} °C night`;

  return (
    <LessonPage id="agriculture/3.2">
      <P>
        <a href={lessonHref('agriculture/3.1')}>The previous lesson</a> showed how much a district’s harvest swings from season to season. Most of those swings are
        made in a few weeks. A crop can shrug off a dry June and be ruined by a dry July; it can survive a hard frost in April and lose most of its grain to a
        lighter one in late May. The difference is the crop’s stage, and in this lesson we’ll inflict the weather’s worst on Cedar Bend’s crops at every point in
        their calendar to see where they are most exposed. Everything else stays as it was in the reference season, so every difference comes from the event.
      </P>
      <P>
        Three kinds of extreme matter most in the valley. A <K tone="red">dry spell</K> — in our model a stretch with no rain, clear skies and hotter afternoons —
        starves the crop of water once the root zone runs low. A <K tone="red">heat wave</K> pushes temperatures past what the crop handles well, and around
        flowering it can spoil pollination. And a <K tone="blue">freeze</K>, a night below the freezing point, damages tissue: in a corn plant late in the season it
        can kill the leaves before the kernels are full, and in wheat in spring it can kill the flowers in the head. In the next demonstration, the curve is the
        reference season’s yield if the chosen event strikes on each date; the shaded bands are the crop’s stages, and the dashed line is the yield with no event at
        all. Choose a crop and an event, then move its date and severity:
      </P>

      <Figure name="Drought and Frost Lab" scenario={s}>
        <Segmented
          label="Crop"
          value={st.crop}
          onChange={(v) => s.set({ crop: v, date: v === 'corn' ? dayOf(7, 10) : dayOf(5, 10), low: v === 'corn' ? -3 : -4 })}
          options={[
            { value: 'corn', label: 'Corn' },
            { value: 'wheat', label: 'Winter wheat' },
          ]}
        />
        <Segmented
          label="Event"
          value={st.kind}
          onChange={(v) => s.set({ kind: v })}
          options={[
            { value: 'drought', label: 'Dry spell' },
            { value: 'heat', label: 'Heat wave' },
            { value: 'frost', label: 'Freeze' },
          ]}
        />
        <DayChart
          days={sw.days}
          series={[{ values: sw.yields, color: CROP_LINE[st.crop], width: 2.5 }]}
          from={a}
          to={b}
          yMin={0}
          yMax={st.crop === 'corn' ? 200 : 80}
          yTicks={st.crop === 'corn' ? [0, 50, 100, 150, 200] : [0, 20, 40, 60, 80]}
          yLabel={`${st.crop === 'corn' ? 'Corn' : 'Wheat'} yield if the event starts on each date, bu/ac`}
          yFormat={(v) => fmt(v)}
          bands={stageBands(base)}
          refLines={[{ y: base.yield, label: 'no event', color: '#777' }]}
          cursor={date}
          height={230}
          ariaLabel={`${st.crop === 'corn' ? 'Corn' : 'Wheat'} yield in the reference season if ${severity} begins on each date from ${dateLabel(a)} to ${dateLabel(b)}. On ${dateLabel(date)} it yields ${fmt(run.yield)} bushels, ${fmt(loss * 100)}% below the ${fmt(base.yield)} with no event.`}
        />
        <Readouts
          items={[
            { label: 'crop stage on that date', value: stageOn(base, date) },
            { label: 'yield', value: buAc(run.yield), tone: st.crop === 'corn' ? 'gold' : 'orange' },
            { label: 'lost to the event', value: `${fmt(Math.max(0, loss) * 100)}%`, tone: 'red' },
          ]}
        />
        <Slider label="Date" value={date} min={a} max={b} onChange={(v) => s.set({ date: v })} display={dateLabel(date)} />
        {st.kind === 'drought' && <Slider label="Dry spell length" tone="red" value={st.days} min={7} max={35} step={7} onChange={(v) => s.set({ days: v })} display={`${st.days} days`} />}
        {st.kind === 'heat' && <Slider label="Heat wave, five days" tone="red" value={st.degrees} min={2} max={10} onChange={(v) => s.set({ degrees: v })} display={`+${st.degrees} °C`} />}
        {st.kind === 'frost' && <Slider label="Night’s low" tone="blue" value={st.low} min={-8} max={-1} onChange={(v) => s.set({ low: v })} display={`${st.low} °C`} />}
      </Figure>

      <P>
        Start with wheat and a freeze. A −4 °C night does almost nothing to the reference season’s wheat in April or early May, when the developing head is still
        tucked inside the stem; it takes about 2% in mid-May. Then, from May 21 — the day after the head reaches the boot — to the end of flowering, the same night
        cuts the crop from 69.5 bushels to about 20: the cold kills the flowers, and a flower that dies never becomes a kernel. A week later the kernels have set,
        and a freeze costs almost nothing again. A −2 °C night in the same window costs only a few percent. The danger is narrow, but on a date that farmers can see
        coming weeks ahead — which is why a late spring freeze forecast on the High Plains moves wheat prices.
      </P>

      <Challenge
        id="a"
        question="Choose winter wheat and a −4 °C freeze. What is the earliest date on which it costs the wheat more than half its yield?"
        solved={solved1}
        status={
          st.crop !== 'wheat' || st.kind !== 'frost'
            ? 'Choose winter wheat and a freeze.'
            : st.low !== -4
              ? `The night’s low is ${st.low} °C. Set it to −4 °C.`
              : `A −4 °C night on ${dateLabel(date)} leaves ${buAc(run.yield, 1)}, ${fmt(loss * 100)}% below normal.`
        }
        success={`Solved: on ${dateLabel(date)}, the head has just pushed into the boot and its flowers are forming, and a −4 °C night leaves ${buAc(run.yield, 1)} of the usual ${buAc(base.yield, 1)}. A day earlier the head was still protected inside the stem. Winter wheat survives far colder nights in winter; what it can’t survive is cold at the moment it makes its flowers.`}
      />

      <P>
        Corn’s calendar has its own weak points. Five days 6 °C hotter than normal cost it little in June, but up to 6% when they arrive at the end of July, when
        hot, dry air slows the crop just as it is deciding how many kernels to keep and beginning to fill them. A freeze late in the summer is worse. A −3 °C night
        on August 15, with the kernels only half full, kills the plants where they stand and leaves 99 bushels; on September 5 it leaves 161, and a week later 178;
        after black layer on September 16 it costs nothing at all. Even a light frost of −1 °C on August 15, which burns only part of the canopy, costs 17 bushels.
        Those are the dates that make an early cold snap in the northern part of a corn belt into news.
      </P>

      <H2>A dry spell does its damage later</H2>
      <P>
        Now switch to corn and a three-week dry spell. You might expect the worst start date to be silking itself, but in the reference season it is June 13,
        five weeks earlier: that spell cuts the yield from 188 bushels to 153, while the same three weeks starting at silking cost only 16 bushels. The reason is
        the root zone. Cedar Bend’s deep soil holds a reserve of water, and a dry spell does no harm until the reserve runs low. In the next demonstration, the upper
        chart is the root zone’s water through the season with and without the event, and the lower one the crop’s growth each day:
      </P>

      <Figure name="Drought and Frost Lab · inside the season" scenario={s}>
        <DayChart
          days={run.days.map((x) => x.day)}
          series={[
            { values: base.days.map((x) => x.water * 100), days: base.days.map((x) => x.day), color: '#999', dash: '6 4', width: 1.8 },
            { values: run.days.map((x) => x.water * 100), color: GRAPHIC.blue, width: 2.5 },
          ]}
          from={st.crop === 'corn' ? dayOf(5, 1) : dayOf(3, 1)}
          to={st.crop === 'corn' ? dayOf(10, 1) : dayOf(7, 10)}
          yMin={0}
          yMax={100}
          yTicks={[0, 25, 50, 75, 100]}
          yLabel="Water left in the root zone, %"
          yFormat={(v) => `${v}%`}
          bands={[eventBand]}
          refLines={[{ y: 45, label: 'stress begins', color: GRAPHIC.red }]}
          height={170}
          ariaLabel={`Root-zone water through the season, with ${severity} from ${dateLabel(date)} and without it.`}
        />
        <DayChart
          days={run.days.map((x) => x.day)}
          series={[
            { values: base.days.map((x) => x.growth), days: base.days.map((x) => x.day), color: '#999', dash: '6 4', width: 1.8 },
            { values: run.days.map((x) => x.growth), color: GRAPHIC.teal, width: 2 },
          ]}
          from={st.crop === 'corn' ? dayOf(5, 1) : dayOf(3, 1)}
          to={st.crop === 'corn' ? dayOf(10, 1) : dayOf(7, 10)}
          yMin={0}
          yMax={60}
          yTicks={[0, 20, 40, 60]}
          yLabel="Growth, g per m² per day"
          yFormat={(v) => fmt(v)}
          bands={[eventBand]}
          height={150}
          ariaLabel={`Daily growth through the season, with ${severity} from ${dateLabel(date)} and without it. The crop yields ${fmt(run.yield)} bushels against ${fmt(base.yield)}.`}
        />
        <Legend
          items={[
            { label: 'With the event', color: GRAPHIC.blue, kind: 'line' },
            { label: 'Without it', color: '#999', kind: 'line', dashed: true },
            { label: 'The event', color: 'rgba(231, 91, 85, .4)' },
          ]}
        />
      </Figure>

      <P>
        With the June 13 spell, the crop barely notices at first — clear skies even make it grow faster for a week. But the reserve drains day by day, the summer’s
        later rains never refill it, and by the time the crop silks in mid-July the root zone is below half full. The crop sets nearly as many kernels as usual, 530
        an ear against 538, then spends August short of water and fills them light. A dry spell that starts at silking finds the reserve full and does less. What
        hurts a crop is not dry weather but dry soil at the wrong time, and the soil keeps a memory of the weeks before. Real droughts often last longer, and then
        the harms compound: stretch the spell to four weeks starting June 26, so that it empties the soil and runs through silking too, and the yield falls to 148.
      </P>

      <Challenge
        id="b"
        question="Choose corn and a 21-day dry spell. Find a start date that costs the corn the most — within a bushel of the worst."
        solved={solved2}
        status={
          st.crop !== 'corn' || st.kind !== 'drought'
            ? 'Choose corn and a dry spell.'
            : st.days !== 21
              ? `The dry spell lasts ${st.days} days. Set it to 21.`
              : `Starting ${dateLabel(date)}, the spell leaves ${buAc(run.yield, 1)}.`
        }
        success={`Solved: a dry spell starting ${dateLabel(date)} leaves ${buAc(run.yield, 1)} of the usual ${buAc(base.yield)}. It does its harm weeks after it starts, by emptying the root zone ahead of silking and grain fill. That is why crop watchers track soil moisture, not just rain.`}
      />

      <P>
        Each of these events leaves fingerprints on the crop before the harvest does: leaves that roll and turn gray-green in a drought, heads that stay pale after a
        freeze. In <FigRef to="Drought and Frost Lab">the lab</FigRef> we could see the damage because we ran the model. In the real valley, nobody can walk every
        field. The next lesson shows how to watch them all at once, from orbit.
      </P>
    </LessonPage>
  );
}
