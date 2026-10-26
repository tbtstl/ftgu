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

/** The reference season's silking date (R1), and the share of the corn, in whole percent as the readout shows it, that a 21-day dry spell starting then costs. */
export const SILKING = BASE.corn.stageDays[STAGES.corn.findIndex((x) => x.code === 'R1')];
export const SILKING_LOSS_PCT = Math.round((1 - grow('corn', [{ kind: 'drought', start: SILKING, days: 21 }]).yield / BASE.corn.yield) * 100);

/** Challenge 2: a 21-day dry spell whose start date costs the corn at least twice what one starting at silking costs (in the readout's whole percent). */
export function droughtSolved(st: LabState): boolean {
  if (st.crop !== 'corn' || st.kind !== 'drought' || st.days !== 21) return false;
  const loss = 1 - grow('corn', [eventOf(st)]).yield / BASE.corn.yield;
  return Math.round(loss * 100) >= 2 * SILKING_LOSS_PCT;
}

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
  const s = useScenario('lab', { crop: 'corn' as Crop, kind: 'frost' as EventKind, date: dayOf(8, 15), days: 21, degrees: 6, low: -3 } as LabState);
  const st = s.state;
  const sw = useMemo(() => sweep(st), [st.crop, st.kind, st.days, st.degrees, st.low]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = useMemo(() => grow(st.crop, [eventOf(st)]), [st]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = BASE[st.crop];
  const loss = 1 - run.yield / base.yield;
  const solved1 = useMemo(() => freezeSolved(st), [st]);
  const [a, b] = RANGE[st.crop];
  const date = Math.max(a, Math.min(b, st.date));
  const severity = st.kind === 'drought' ? `${st.days} days without rain` : st.kind === 'heat' ? `five days ${st.degrees} °C hotter` : `a ${fmt(st.low)} °C night`;

  // The second demonstration: corn and a dry spell, with its own start date and length.
  const ds = useScenario('inside', { date: SILKING, days: 21 });
  const dry: LabState = { crop: 'corn', kind: 'drought', date: Math.max(RANGE.corn[0], Math.min(RANGE.corn[1], ds.state.date)), days: ds.state.days, degrees: 6, low: -3 };
  const dryRun = useMemo(() => grow('corn', [eventOf(dry)]), [dry.date, dry.days]); // eslint-disable-line react-hooks/exhaustive-deps
  const dryBase = BASE.corn;
  const dryLoss = 1 - dryRun.yield / dryBase.yield;
  const dryBand: DayBand = { from: dry.date, to: dry.date + dry.days, color: 'rgba(231, 91, 85, .2)' };
  const solved2 = useMemo(() => droughtSolved(dry), [dry.date, dry.days]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LessonPage id="agriculture/3.2">
      <P>
        <a href={lessonHref('agriculture/3.1')}>The previous lesson</a> showed how much a district’s harvest swings from season to season. Most of those swings are
        made in a few weeks, and when the weather strikes matters as much as how hard. A crop can survive a hard frost in April and lose most of its grain to a
        lighter one in late May, and a dry spell can do its damage weeks after the rain returns. The difference is the crop’s stage, and in this lesson we’ll
        inflict the weather’s worst on Cedar Bend’s crops at every point in
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
        Start with wheat and a freeze. Winter wheat spends the winter as a low tuft of leaves and lives through nights far colder than −4 °C. In spring it
        joints: the stem lengthens and carries the young head up inside it. At the <b>boot</b> stage the head swells inside the sheath of the top leaf, just
        before it emerges; then it heads out and flowers, and the flowers that are fertilized become kernels.
      </P>

      <Challenge
        id="a"
        question="Predict first: at which stage does a −4 °C night start to cost the wheat more than half its crop — jointing, boot, heading or flowering? Then choose winter wheat and a −4 °C freeze, and find the earliest date on which it does."
        solved={solved1}
        status={
          st.crop !== 'wheat' || st.kind !== 'frost'
            ? 'Choose winter wheat and a freeze.'
            : st.low !== -4
              ? `The night’s low is ${st.low} °C. Set it to −4 °C.`
              : `A −4 °C night on ${dateLabel(date)} leaves ${buAc(run.yield, 1)}, ${fmt(loss * 100)}% below normal.`
        }
        success={`Solved: on ${dateLabel(date)} the head has just pushed into the boot, its flowers still forming inside the leaf sheath, and a −4 °C night leaves ${buAc(run.yield, 1)} of the usual ${buAc(base.yield, 1)}. A day earlier the head was still deep in the stem. The danger begins before the flowers open, while they are still being made: winter wheat that shrugs off far colder nights in winter can’t survive cold at the moment it makes its flowers.`}
      />

      <P>
        A −4 °C night does almost nothing to the reference season’s wheat in April or early May, when the developing head is still tucked inside the stem; it
        takes about 2% in mid-May. Then, from May 21, the day after the head reaches the boot, to the end of flowering, the same night cuts the crop from 69.5
        bushels to about 20: the cold kills the flowers, and a flower that dies never becomes a kernel. A week later the kernels have set, and a freeze costs almost
        nothing again. A −2 °C night in the same window costs only a few percent in our model; real wheat in flower is more tender, and agronomists warn of injury
        from about −1 °C held for a couple of hours. The danger is narrow, but on a date that farmers can see coming weeks ahead — which is why a late spring
        freeze forecast on the High Plains moves wheat prices.
      </P>

      <P>
        Corn’s calendar has its own weak points. Five days 6 °C hotter than normal cost it little in June, but up to 6% when they arrive at the end of July, when
        hot, dry air slows the crop just as it is deciding how many kernels to keep and beginning to fill them. A freeze late in the summer is worse. A −3 °C night
        on August 15, with the kernels only half full, kills the plants where they stand and leaves 99 bushels; on September 5 it leaves 161, and a week later 178;
        after black layer on September 16 it costs nothing at all. Even a light frost of −1 °C on August 15, which burns only part of the canopy, costs 17 bushels.
        Those are the dates that make an early cold snap in the northern part of a corn belt into news.
      </P>

      <H2>A dry spell does its damage later</H2>
      <P>
        Corn and a three-week dry spell hold a surprise. Silking is when the crop decides how many kernels to keep, so you might expect a dry spell to do the
        most harm when it starts there. In the next demonstration the crop is corn and the event a dry spell, starting at silking on July 17; the upper chart is
        the root zone’s water through the season with and without it, and the lower one the crop’s growth each day. Move the dry spell’s start and change its
        length:
      </P>

      <Figure name="Drought and Frost Lab · inside the season" scenario={ds}>
        <DayChart
          days={dryRun.days.map((x) => x.day)}
          series={[
            { values: dryBase.days.map((x) => x.water * 100), days: dryBase.days.map((x) => x.day), color: '#999', dash: '6 4', width: 1.8 },
            { values: dryRun.days.map((x) => x.water * 100), color: GRAPHIC.blue, width: 2.5 },
          ]}
          from={dayOf(5, 1)}
          to={dayOf(10, 1)}
          yMin={0}
          yMax={100}
          yTicks={[0, 25, 50, 75, 100]}
          yLabel="Water left in the root zone, %"
          yFormat={(v) => `${v}%`}
          bands={[dryBand]}
          refLines={[{ y: 45, label: 'stress begins', color: GRAPHIC.red }]}
          height={170}
          ariaLabel={`Root-zone water through the season, with ${dry.days} days without rain from ${dateLabel(dry.date)} and without it.`}
        />
        <DayChart
          days={dryRun.days.map((x) => x.day)}
          series={[
            { values: dryBase.days.map((x) => x.growth), days: dryBase.days.map((x) => x.day), color: '#999', dash: '6 4', width: 1.8 },
            { values: dryRun.days.map((x) => x.growth), color: GRAPHIC.teal, width: 2 },
          ]}
          from={dayOf(5, 1)}
          to={dayOf(10, 1)}
          yMin={0}
          yMax={60}
          yTicks={[0, 20, 40, 60]}
          yLabel="Growth, g per m² per day"
          yFormat={(v) => fmt(v)}
          bands={[dryBand]}
          height={150}
          ariaLabel={`Daily growth through the season, with ${dry.days} days without rain from ${dateLabel(dry.date)} and without it. The corn yields ${fmt(dryRun.yield)} bushels against ${fmt(dryBase.yield)}.`}
        />
        <Legend
          items={[
            { label: 'Water, with the dry spell', color: GRAPHIC.blue, kind: 'line' },
            { label: 'Growth, with it', color: GRAPHIC.teal, kind: 'line' },
            { label: 'Without it', color: '#999', kind: 'line', dashed: true },
            { label: 'The dry spell', color: 'rgba(231, 91, 85, .4)' },
          ]}
        />
        <Readouts
          items={[
            { label: 'corn yield', value: buAc(dryRun.yield), tone: 'gold' },
            { label: 'lost to the dry spell', value: `${fmt(Math.max(0, dryLoss) * 100)}%`, tone: 'red' },
          ]}
        />
        <Slider label="Dry spell starts" value={dry.date} min={RANGE.corn[0]} max={RANGE.corn[1]} onChange={(v) => ds.set({ date: v })} display={dateLabel(dry.date)} />
        <Slider label="Dry spell length" tone="red" value={dry.days} min={7} max={35} step={7} onChange={(v) => ds.set({ days: v })} display={`${dry.days} days`} />
      </Figure>

      <Challenge
        id="b"
        question={`Predict first: does a three-week dry spell do the most harm when it starts at silking, or weeks before or after it? Then, with a 21-day spell, find a start date that costs the corn at least ${2 * SILKING_LOSS_PCT}% of its crop — twice the ${SILKING_LOSS_PCT}% that a spell starting at silking costs.`}
        solved={solved2}
        status={dry.days !== 21 ? `The dry spell lasts ${dry.days} days. Set it to 21.` : `Starting ${dateLabel(dry.date)}, the spell costs ${fmt(Math.max(0, dryLoss) * 100)}% of the crop.`}
        success={`Solved: a dry spell starting ${dateLabel(dry.date)} leaves ${buAc(dryRun.yield, 1)} of the usual ${buAc(dryBase.yield)}, ${fmt(dryLoss * 100)}% of the crop, against ${SILKING_LOSS_PCT}% for the same spell at silking. It does its harm weeks after it starts, by emptying the root zone ahead of silking and grain fill. That is why crop watchers track soil moisture, not just rain.`}
      />

      <P>
        The worst start date in the reference season is June 13, five weeks before silking: that spell cuts the yield from 188 bushels to 153, while the same three
        weeks starting at silking cost only 16 bushels. The reason is the root zone. Cedar Bend’s deep soil holds a reserve of water, and a dry spell does no harm
        until the reserve runs low. With the June 13 spell, the crop barely notices at first — clear skies even make it grow faster for a week. But the reserve
        drains day by day, the summer’s later rains never refill it, and by the time the crop silks in mid-July the root zone is below half full. The crop sets
        nearly as many kernels as usual, 530 an ear against 538, then spends August short of water and fills them light. A dry spell that starts at silking finds
        the reserve full and does less. What hurts a crop is not dry weather but dry soil at the wrong time, and the soil keeps a memory of the weeks before. Real
        droughts often last longer, and then the harms compound: stretch the spell to four weeks starting June 26, so that it empties the soil and runs through
        silking too, and the yield falls to 148.
      </P>

      <P>
        Each of these events leaves fingerprints on the crop before the harvest does: leaves that roll and turn gray-green in a drought, heads that stay pale after a
        freeze. In <FigRef to="Drought and Frost Lab">the lab</FigRef> we could see the damage because we ran the model. In the real valley, nobody can walk every
        field. The next lesson shows how to watch them all at once, from orbit.
      </P>
    </LessonPage>
  );
}
