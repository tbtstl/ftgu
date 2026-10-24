import { useMemo, useState } from 'react';
import {
  Challenge,
  Eq,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  Sub,
  fmt,
  lessonHref,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { STAGES, gdd, simulateSeason, stageAt, type SeasonResult } from '../../../engines/agriculture/crop';
import { REFERENCE_YEAR, applyShift, firstColdSpell, frostDates, simulatedYear } from '../../../model/agriculture/climate';
import { DISTRICT, DISTRICTS, MONTHS, MONTH_START, dateLabel, dayOf, type DistrictId } from '../../../model/agriculture/region';
import { DayChart } from '../shared/DayChart';
import { CornPlant, WheatPlant } from '../shared/Plant';
import { CROP_LINE } from '../shared/tones';

const PRAIRIE = DISTRICT.prairie;
const WEATHER = simulatedYear(REFERENCE_YEAR, 'prairie');
const KILL = frostDates(WEATHER, -2).firstFall;
const COLD = firstColdSpell(WEATHER);

/** Did cold weather end the season before the hybrid reached black layer on its own? */
function cutShort(r: SeasonResult): boolean {
  return r.killed || r.premature;
}

/** How the season ended, for labels: "black layer" or "cold ended fill". */
function ending(r: SeasonResult): { label: string; day: number } {
  if (r.killed) return { label: 'killed by frost', day: r.maturityDay };
  if (r.premature) return { label: 'cold ended grain fill', day: r.maturityDay };
  return { label: 'black layer', day: r.maturityDay };
}
const LATE_PLANT = dayOf(6, 5);
const SPEED = 14; // days of season per second of animation

function grow(plant: number, hybrid: number, shift: number): SeasonResult {
  return simulateSeason(applyShift(WEATHER, { temp: shift }), {
    crop: 'corn',
    plantDay: plant,
    maturityGdd: hybrid,
    pawIn: PRAIRIE.pawIn,
    startWater: PRAIRIE.springWater,
  });
}

/** The challenge: planted June 5, the longest hybrid (in 25-GDD steps) that reaches black layer before the killing frost. */
export function lateHybridSolved(plant: number, hybrid: number, shift: number): boolean {
  if (plant !== LATE_PLANT || shift !== 0) return false;
  return !cutShort(grow(plant, hybrid, 0)) && cutShort(grow(plant, hybrid + 25, 0));
}

function stageName(r: SeasonResult, i: number) {
  if (i < 0) return 'planted';
  const s = STAGES[r.crop][i];
  return `${s.code} · ${s.name}`;
}

/** A row of stage spans across the calendar. */
function CalendarRow({ y, spans, label }: { y: number; spans: Array<{ from: number; to: number; color: string; label?: string }>; label: string }) {
  const x = (d: number) => 56 + (d / 365) * 570;
  return (
    <g>
      <text className="lab" x={52} y={y + 14} textAnchor="end">
        {label}
      </text>
      {spans.map((s, i) =>
        s.to > s.from ? (
          <g key={i}>
            <rect x={x(s.from)} y={y} width={x(s.to) - x(s.from)} height={20} fill={s.color} rx={2} />
            {s.label && x(s.to) - x(s.from) > 44 && (
              <text className="ax" x={(x(s.from) + x(s.to)) / 2} y={y + 14} textAnchor="middle" style={{ fill: '#333' }}>
                {s.label}
              </text>
            )}
          </g>
        ) : null,
      )}
    </g>
  );
}

function LifecycleAnimator({ playing, onTick }: { playing: boolean; onTick: (dt: number) => void }) {
  useAnimationFrame((dt) => onTick(dt), playing);
  return null;
}

export default function Lesson() {
  const s = useScenario('lifecycle', { plant: dayOf(5, 1), hybrid: PRAIRIE.hybridGdd, shift: 0 });
  const { plant, hybrid, shift } = s.state;
  const play = usePlay(true);
  const [t, setT] = useState(30);
  const season = useMemo(() => grow(plant, hybrid, shift), [plant, hybrid, shift]);
  const span = season.days.length + 20;
  const idx = Math.min(season.days.length - 1, Math.floor(t));
  const today = season.days[Math.max(0, idx)];
  const day = plant + Math.floor(t);
  const w = applyShift(WEATHER, { temp: shift })[Math.min(364, day)];
  const g = gdd('corn', w.tmax, w.tmin);
  const r1 = season.stageDays[4];
  const r6 = season.stageDays[9];
  const solved = lateHybridSolved(plant, hybrid, shift);
  const cut = cutShort(season);
  const end = ending(season);
  const killDev = cut ? season.days[season.days.length - 1].dev : 1;

  const d2 = useScenario('calendars', { district: 'prairie' as DistrictId, day: dayOf(5, 20) });
  const dist = DISTRICT[d2.state.district];
  const cal = useMemo(() => {
    const wy = simulatedYear(REFERENCE_YEAR, dist.id);
    const corn = simulateSeason(wy, { crop: 'corn', plantDay: dayOf(5, 1), maturityGdd: dist.hybridGdd, pawIn: dist.pawIn, startWater: dist.springWater });
    const wheat = simulateSeason(wy, { crop: 'wheat', pawIn: dist.pawIn, startWater: dist.springWater });
    const temps = wy.map((x) => (x.tmax + x.tmin) / 2);
    return { wy, corn, wheat, temps, kill: frostDates(wy, -2).firstFall, cold: firstColdSpell(wy) };
  }, [dist]);
  const at = (r: SeasonResult, code: string) => r.stageDays[STAGES[r.crop].findIndex((x) => x.code === code)];
  const cornEnd = at(cal.corn, 'R6') >= 0 ? at(cal.corn, 'R6') : cal.corn.maturityDay;
  const wheatEnd = at(cal.wheat, 'R') >= 0 ? at(cal.wheat, 'R') : cal.wheat.maturityDay;
  const devOn = (r: SeasonResult, d: number) => {
    if (d < r.start) return -1;
    const e = r.days.find((x) => x.day === d);
    return e ? e.dev : r.days[r.days.length - 1].dev;
  };
  const cornDev = devOn(cal.corn, d2.state.day);
  const wheatDev = devOn(cal.wheat, d2.state.day);
  const wheatGone = d2.state.day > wheatEnd + 10;
  const cornGone = d2.state.day > cal.corn.maturityDay + 30;
  const calEnd = ending(cal.corn);

  return (
    <LessonPage id="agriculture/1.2">
      <P>
        In <a href={lessonHref('agriculture/1.1')}>the previous lesson</a> a canopy’s leaf area was a slider. In a field it’s a schedule. A corn seed planted at Cedar Bend
        in May has to put out roots, push up a shoot, unfold leaf after leaf until it shades the ground, flower, and then fill its kernels before the first hard frost
        of autumn. How fast it moves through those steps decides when it flowers, how long it has to fill grain, and whether it finishes at all.
      </P>
      <P>
        Farmers and agronomists separate two things a crop does. <b>Growth</b> is gaining mass, and the previous lesson showed it’s mostly a matter of light.{' '}
        <b>Development</b> is progress through the plant’s stages, and it’s mostly a matter of temperature. A corn plant develops faster on a warm day than a cool one,
        and hardly at all below about 10 °C. The standard way to count development is in <K tone="teal">growing degree days</K> (GDD): each day adds its mean
        temperature above that 10 °C base. Corn develops no faster above 30 °C, so first the day’s high is held to 30 and its low raised to 10:
      </P>
      <Eq label="Growing degree days for one day">
        <span>GDD</span>
        <Op>=</Op>
        <span>
          (min(T<Sub>high</Sub>, 30) + max(T<Sub>low</Sub>, 10)) ÷ 2
        </span>
        <Op>−</Op>
        <span>10</span>
      </Eq>
      <P>
        A hybrid is sold by how many of these it needs from planting to maturity. The standard hybrid on the Black Prairie needs 1,500 °C·days. (Seed companies in the
        United States count in Fahrenheit, which makes every number 1.8 times larger: the same hybrid is a “2,700-GDD” corn.) The next demonstration grows it at Cedar
        Bend through the reference season, a simulated year with close-to-normal weather that we’ll use throughout this chapter. Press play, or drag the day, and try
        a different planting date, hybrid or a warmer or cooler year:
      </P>

      <Figure name="Crop Lifecycle" scenario={s} play={play}>
        <LifecycleAnimator playing={play.playing} onTick={(dt) => setT((x) => (x + dt * SPEED >= span ? 0 : x + dt * SPEED))} />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.25fr)', gap: 12, alignItems: 'end' }}>
          <svg
            className="diagram"
            viewBox="0 0 240 300"
            role="img"
            aria-label={`A corn plant on ${dateLabel(day, true)}: ${t >= season.days.length - 1 ? end.label : stageName(season, today.stage)}, ${fmt(today.gdd)} growing degree days since planting.`}
          >
            <rect x={0} y={262} width={240} height={38} fill="#e9e1d2" />
            <CornPlant dev={t >= season.days.length ? killDev : today.dev} x={120} y={262} height={210} alive={!(cut && t >= season.days.length - 1)} />
          </svg>
          <div>
            <div style={{ fontSize: 13, color: '#5f5f5f' }}>{dateLabel(day, true)}</div>
            <div style={{ fontSize: 20, fontWeight: 500, margin: '2px 0 8px' }}>
              {t >= season.days.length - 1 ? (cut ? end.label[0].toUpperCase() + end.label.slice(1) : 'R6 · black layer') : stageName(season, today.stage)}
            </div>
            <div style={{ fontSize: 14, color: '#5f5f5f', lineHeight: 1.6 }}>
              High {fmt(w.tmax, 1)} °C, low {fmt(w.tmin, 1)} °C: <span className="tone-teal">{fmt(g, 1)} GDD</span> today
              <br />
              {fmt(today.gdd)} of {fmt(hybrid)} GDD since planting
              <br />
              Leaf area index {fmt(today.lai, 1)}
            </div>
          </div>
        </div>
        <DayChart
          days={season.days.map((x) => x.day)}
          series={[{ values: season.days.map((x) => x.gdd), color: GRAPHIC.teal, width: 2.5 }]}
          from={dayOf(4, 1)}
          to={dayOf(11, 30)}
          yMin={0}
          yMax={1800}
          yTicks={[0, 500, 1000, 1500]}
          yLabel="Growing degree days since planting, °C·days"
          yFormat={(v) => fmt(v)}
          height={200}
          refLines={[
            { y: hybrid * stageAt('corn', 'R1'), label: 'silking', color: GRAPHIC.gold },
            { y: hybrid, label: 'black layer', color: '#333' },
          ]}
          marks={[
            { day: COLD, label: 'first cold spell', color: GRAPHIC.blue, dash: '4 3' },
            { day: KILL, label: 'killing frost', color: GRAPHIC.red, dash: '4 3', row: 1 },
          ]}
          cursor={Math.min(day, dayOf(11, 30))}
          onScrub={(d) => {
            play.setPlaying(false);
            setT(Math.max(0, d - plant));
          }}
          ariaLabel={`Growing degree days since planting on ${dateLabel(plant)}, for a ${fmt(hybrid)}-GDD hybrid. Silking on ${r1 >= 0 ? dateLabel(r1) : 'no date'}; ${end.label} on ${dateLabel(end.day)}.`}
        />
        <Readouts
          items={[
            { label: 'silking', value: r1 >= 0 ? dateLabel(r1) : '—', tone: 'gold' },
            { label: end.label, value: dateLabel(end.day), tone: cut ? 'red' : 'ink' },
            { label: 'days, planting to the end', value: fmt(season.maturityDay - plant) },
          ]}
        />
        <Slider label="Planting date" value={plant} min={dayOf(4, 10)} max={dayOf(6, 15)} onChange={(v) => s.set({ plant: v })} display={dateLabel(plant)} />
        <Slider label="Hybrid" tone="teal" value={hybrid} min={1200} max={1650} step={25} onChange={(v) => s.set({ hybrid: v })} display={`${fmt(hybrid)} GDD`} />
        <Slider label="Warmer or cooler year" tone="red" value={shift} min={-3} max={3} step={0.5} onChange={(v) => s.set({ shift: v })} display={`${shift > 0 ? '+' : ''}${fmt(shift, 1)} °C`} />
      </Figure>

      <P>
        Planted on May 1, the standard hybrid emerges on May 13, after about 70 GDD. For the next two months it is in its <b>vegetative</b> stages, named for the
        number of leaves with a visible collar: V6, V12 and so on. The growing point stays below the soil until about V6, which is why an early frost can burn the
        leaves of young corn without killing it. On July 13 the tassel appears (VT), and four days later the silks emerge from the young ear: <b>silking</b>, or R1.
        Each silk is attached to one potential kernel, and pollen from the tassels has to land on it. Everything after that is <b>reproductive</b>: blister, milk,
        dough and dent, as the kernels fill with starch, until on September 16 a dark layer forms at the base of each kernel and cuts it off from the plant. That{' '}
        <b>black layer</b>, R6, is physiological maturity: the kernels hold all the dry matter they ever will.
      </P>
      <P>
        Slide the year warmer. At +2 °C the crop silks on July 7 and reaches black layer on August 26, three weeks early. That isn’t good news: the same number of
        degree days now passes in fewer days, so the canopy has less time to catch light while the kernels fill. A cooler year stretches the season instead, and
        brings the opposite risk. Autumn ends a corn season in two steps. First comes a run of cold days — in our model, four in a row averaging under 12 °C, which
        in the reference season is complete on October 9. A crop still filling its kernels then simply stops, short of its own black layer: a{' '}
        <b>premature black layer</b>, with lighter kernels than it would have had. Weeks later a <b>killing frost</b>, a low of −2 °C or colder, kills whatever
        leaves are left; in the reference season it comes on November 16. At −2 °C the crop is still filling on October 3 when a cold spell stops it.
      </P>

      <Challenge
        id="a"
        question="Suppose rain holds Cedar Bend’s planting back to June 5, in the reference season’s normal temperatures. What is the longest-season hybrid that still reaches black layer on its own, before cold weather stops it?"
        solved={solved}
        status={
          plant !== LATE_PLANT
            ? `Set the planting date to June 5. It is ${dateLabel(plant)}.`
            : shift !== 0
              ? 'Set the year back to normal temperatures (+0.0 °C).'
              : cut
                ? `A ${fmt(hybrid)}-GDD hybrid is stopped short by the cold on ${dateLabel(season.maturityDay)}, before black layer.`
                : `A ${fmt(hybrid)}-GDD hybrid reaches black layer on ${r6 >= 0 ? dateLabel(r6) : '—'}. Could a longer one make it?`
        }
        success={`Solved. Planted June 5, a ${fmt(hybrid)}-GDD hybrid reaches black layer on ${r6 >= 0 ? dateLabel(r6) : '—'}; one 25 GDD longer would still be filling when the cold arrives. Longer-season hybrids usually yield more, because they spend more days catching light, but only if they finish. Late planting forces a real trade: switch to a shorter hybrid and give up some yield, or keep the long one and gamble on a warm autumn.`}
      />

      <H2>Winter wheat keeps a different calendar</H2>
      <P>
        Wheat counts degree days from a base of 0 °C, not 10, and that one difference puts it on the other side of the year. The valley’s wheat is <b>winter
        wheat</b>: sown in late September or October, it sprouts and grows a few leaves before winter, then sits dormant under the cold. Winter varieties actually
        need that cold. Until they have spent several weeks near freezing — <b>vernalization</b> — they won’t flower at all, which is why they’re sown in autumn rather
        than spring. When the soil warms in March the crop greens up, the stems lengthen (jointing), the heads emerge in May, and the grain ripens in June or July,
        when corn planted the same spring is barely knee-high.
      </P>
      <P>
        In the next demonstration, the bars are the two crops’ calendars in each district in the reference season, from the same weather; the line underneath is the
        daily mean temperature, with the two crops’ base temperatures marked. Choose a district, and drag across the year to see both plants:
      </P>

      <Figure name="Crop Lifecycle · two calendars" scenario={d2}>
        <Segmented
          label="District"
          value={d2.state.district}
          onChange={(v) => d2.set({ district: v })}
          options={DISTRICTS.map((d) => ({ value: d.id, label: d.name }))}
        />
        <svg
          className="diagram"
          viewBox="0 0 640 190"
          role="img"
          aria-label={`${dist.name} on ${dateLabel(d2.state.day, true)} of the reference season. Winter wheat greens up on ${dateLabel(at(cal.wheat, 'GU'))}, heads on ${dateLabel(at(cal.wheat, 'H'))} and is ripe on ${dateLabel(wheatEnd)}. Corn planted May 1 silks on ${dateLabel(at(cal.corn, 'R1'))}; ${calEnd.label} on ${dateLabel(calEnd.day)}.`}
        >
          <rect x={0} y={150} width={640} height={40} fill="#e9e1d2" />
          <g transform="translate(0,0)">
            {!wheatGone && <WheatPlant dev={Math.max(0, wheatDev)} x={180} y={150} height={110} />}
            {wheatGone && (
              <text className="ax" x={180} y={140} textAnchor="middle">
                wheat harvested
              </text>
            )}
          </g>
          {cornDev < 0 ? (
            <text className="ax" x={430} y={140} textAnchor="middle">
              corn not yet planted
            </text>
          ) : cornGone ? (
            <text className="ax" x={430} y={140} textAnchor="middle">
              corn harvested
            </text>
          ) : (
            <CornPlant dev={cornDev} x={430} y={150} height={130} alive={!(cutShort(cal.corn) && d2.state.day >= cal.corn.maturityDay)} />
          )}
          <text className="lab" x={180} y={176} textAnchor="middle" style={{ fill: '#ad5310' }}>
            winter wheat
          </text>
          <text className="lab" x={430} y={176} textAnchor="middle" style={{ fill: '#8a6500' }}>
            corn
          </text>
        </svg>
        <svg className="chart" viewBox="0 0 640 74" role="img" aria-label="Stage calendars for winter wheat and corn">
          <CalendarRow
            y={6}
            label="Wheat"
            spans={[
              { from: 0, to: at(cal.wheat, 'GU'), color: '#e4e2dc', label: 'dormant' },
              { from: at(cal.wheat, 'GU'), to: at(cal.wheat, 'H'), color: '#cfe3b9', label: 'leaves, stems' },
              { from: at(cal.wheat, 'H'), to: at(cal.wheat, 'M'), color: '#f2d9a6', label: 'heads' },
              { from: at(cal.wheat, 'M'), to: wheatEnd, color: '#e9b77a', label: 'grain fill' },
              { from: wheatEnd, to: wheatEnd + 12, color: CROP_LINE.wheat },
            ]}
          />
          <CalendarRow
            y={36}
            label="Corn"
            spans={[
              { from: dayOf(5, 1), to: at(cal.corn, 'VE'), color: '#e4e2dc' },
              { from: at(cal.corn, 'VE'), to: at(cal.corn, 'VT'), color: '#cfe3b9', label: 'leaves' },
              { from: at(cal.corn, 'VT'), to: at(cal.corn, 'R2'), color: '#f2d9a6', label: 'silks' },
              { from: at(cal.corn, 'R2'), to: cornEnd, color: '#ecd27a', label: 'grain fill' },
            ]}
          />
          {MONTHS.map((m, i) => (
            <text key={m} className="ax ax-m" x={56 + ((MONTH_START[i] + 15) / 365) * 570} y={72}>
              {m}
            </text>
          ))}
          <line className="cur" x1={56 + (d2.state.day / 365) * 570} x2={56 + (d2.state.day / 365) * 570} y1={2} y2={60} />
        </svg>
        <DayChart
          days={cal.temps.map((_, i) => i)}
          series={[{ values: cal.temps, color: GRAPHIC.red, width: 1.5 }]}
          from={0}
          to={364}
          yMin={-20}
          yMax={35}
          yTicks={[-20, -10, 0, 10, 20, 30]}
          yLabel="Daily mean temperature, °C"
          yFormat={(v) => fmt(v)}
          height={170}
          refLines={[
            { y: 0, label: 'wheat’s base, 0 °C', color: CROP_LINE.wheat, dash: '5 4' },
            { y: 10, label: 'corn’s base, 10 °C', color: CROP_LINE.corn, dash: '5 4' },
          ]}
          marks={[{ day: cal.cold, label: 'first cold spell', color: GRAPHIC.blue }, { day: cal.kill, label: 'killing frost', color: GRAPHIC.red, row: 1 }]}
          cursor={d2.state.day}
          onScrub={(d) => d2.set({ day: d })}
          ariaLabel={`Daily mean temperature through the reference season in ${dist.name}, with the base temperatures of wheat (0 °C) and corn (10 °C).`}
        />
        <Legend
          items={[
            { label: 'Daily mean temperature', color: GRAPHIC.red, kind: 'line' },
            { label: 'Wheat’s base', color: CROP_LINE.wheat, kind: 'line', dashed: true },
            { label: 'Corn’s base', color: CROP_LINE.corn, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'wheat ripe', value: dateLabel(wheatEnd), tone: 'orange' },
            { label: `corn: ${calEnd.label}`, value: dateLabel(calEnd.day), tone: 'gold' },
            { label: 'first killing frost', value: dateLabel(cal.kill), tone: 'red' },
          ]}
        />
      </Figure>

      <P>
        On the Black Prairie the reference season’s wheat greens up on March 22, heads on May 24 and is ripe on June 30 — two weeks before the corn even silks. In the
        warmer High Plains the wheat is ripe on June 15; in the North Tier not until July 22. The North’s corn, an earlier hybrid of 1,250 GDD, silks on July 23 and
        is still short of black layer when cold weather stops it on September 30, three days before the North’s first killing frost. For a short-season district,
        the end of the season is a yearly worry.
      </P>
      <P>
        These calendars matter far beyond the farm. Wheat comes off the fields in early summer and corn in the fall, so the two crops flood into elevators and onto
        the market at different times of year, and the prices of each carry a seasonal rhythm set by its harvest. We’ll trace that rhythm through storage in Chapter 4
        and into futures prices in Chapter 5. Before that, the crop needs more than warmth and light. Its leaves are built from nitrogen, its energy currency from
        phosphorus, and it gets both from the soil. In <FigRef to="Crop Lifecycle">the lifecycle demonstration</FigRef> the canopy filled in on schedule because the
        soil gave it everything it asked for; the next lesson asks what happens when it can’t.
      </P>
    </LessonPage>
  );
}

