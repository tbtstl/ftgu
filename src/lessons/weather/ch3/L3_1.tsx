import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
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
  hour,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  pct,
  scale,
  signed,
  tint,
  useScenario,
} from '../../../framework';
import { NO_FAULTS, heatIslandWeight, monthBias, readCurve, recorded, trueDay, type Faults } from '../../../engines/weather/sensors';
import type { StationDay } from '../../../engines/weather/station';
import { YEARS, dayIndex, dayInfo, monthDays } from '../../../model/weather/archive';
import { MONTH_DAYS, MONTH_NAMES } from '../../../model/weather/region';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The first demonstration: one day at Calder Bay's station.

export interface DayChoice {
  year: number;
  /** 0–11. */
  month: number;
  /** Day of the month; clamped to the month's length. */
  dom: number;
}

export const STATION_DEFAULTS: DayChoice = { year: 20, month: 0, dom: 12 };

/** The archive index of the chosen day. */
export function dayOf(st: DayChoice): number {
  return dayIndex(st.year, st.month, Math.min(st.dom, MONTH_DAYS[st.month]));
}

/** The winter months, December through February. */
export const WINTER_MONTHS = [11, 0, 1];
/** The first challenge: a winter day whose 24-hour average is at least this much warmer than its official mean, °F. */
export const GAP_TARGET = 0.25;

export function gapSolved(st: DayChoice): boolean {
  if (!WINTER_MONTHS.includes(st.month)) return false;
  const day = trueDay(dayOf(st));
  return day.hourlyMeanF - day.officialMeanF >= GAP_TARGET - 1e-9;
}

// ---------------------------------------------------------------------------
// The second demonstration: a faulty sensor.

export type Example = 'january' | 'july';
/** Two clear days from the simulated archive. */
export const EXAMPLE_DAYS: Record<Example, number> = { january: dayIndex(20, 0, 22), july: dayIndex(20, 6, 18) };
export const FAULT_DEFAULTS = { ...NO_FAULTS, example: 'july' as Example };
/** The second challenge's missing shield: 3 °F of warming in full sun. */
export const SHIELD_FAULT = 3;
export const BIAS_TOLERANCE = 0.05;

/** The second challenge: with only the 3 °F shield fault, an offset that makes January's average daily mean come out right. */
export function correctionSolved(f: Faults): boolean {
  return f.unshielded === SHIELD_FAULT && f.heatIsland === 0 && Math.abs(monthBias(0, f).mean) < BIAS_TOLERANCE;
}

// ---------------------------------------------------------------------------
// Drawing.

const X0 = 56;
const X1 = 620;
const X = scale(0, 23, X0, X1);
const HOUR_TICKS = [0, 6, 12, 18, 23];
const TEMP = GRAPHIC.red;
const DEW = GRAPHIC.teal;

function dateLabel(st: DayChoice): string {
  return `${MONTH_NAMES[st.month]} ${Math.min(st.dom, MONTH_DAYS[st.month])}, year ${st.year}`;
}

function argmax(xs: number[]) {
  return xs.indexOf(Math.max(...xs));
}
function argmin(xs: number[]) {
  return xs.indexOf(Math.min(...xs));
}

/** An arrow pointing the way the wind blows, centered at (x, y). */
function WindArrow({ x, y, from, speed }: { x: number; y: number; from: number; speed: number }) {
  const len = Math.min(30, 6 + speed * 3);
  const to = ((from + 180) * Math.PI) / 180;
  const dx = Math.sin(to) * len;
  const dy = -Math.cos(to) * len;
  const tx = x + dx / 2;
  const ty = y + dy / 2;
  const ux = dx / len;
  const uy = dy / len;
  const bx = tx - ux * 6;
  const by = ty - uy * 6;
  return (
    <g>
      <line x1={x - dx / 2} y1={y - dy / 2} x2={bx} y2={by} stroke={GRAPHIC.violet} strokeWidth={2} strokeLinecap="round" />
      <polygon points={`${tx},${ty} ${bx - uy * 3.5},${by + ux * 3.5} ${bx + uy * 3.5},${by - ux * 3.5}`} fill={GRAPHIC.violet} />
    </g>
  );
}

function DayChart({ day, st }: { day: StationDay; st: DayChoice }) {
  const t = day.hours.map((h) => h.trueF);
  const dew = day.hours.map((h) => h.dewF);
  const [lo, hi] = niceDomain(Math.min(...dew) - 2, Math.max(...t) + 4, 4);
  const ty = scale(lo, hi, 186, 30);
  const iMax = argmax(t);
  const iMin = argmin(t);
  const p = day.hours.map((h) => h.pressureHpa);
  const [p0, p1] = niceDomain(Math.min(...p) - 0.5, Math.max(...p) + 0.5, 2);
  const py = scale(p0, p1, 292, 228);
  const rainMax = Math.max(0.1, ...day.hours.map((h) => h.rainIn));
  const rainH = (r: number) => (r / rainMax) * 56;
  const official = day.officialMeanF;
  const avg = day.hourlyMeanF;
  const officialAbove = official >= avg;
  const rh = day.hours.map((h) => h.rh);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 386"
      role="img"
      aria-label={`Calder Bay’s station on ${dateLabel(st)} (simulated). The temperature peaks at ${fmt(day.trueMax, 1)} °F at ${hour(iMax)} and bottoms at ${fmt(day.trueMin, 1)} °F at ${hour(iMin)}, so the official daily mean is ${fmt(official, 2)} °F; the average of the 24 hourly readings is ${fmt(avg, 2)} °F. Relative humidity runs from ${pct(Math.min(...rh))} to ${pct(Math.max(...rh))}. Pressure moves between ${fmt(Math.min(...p), 1)} and ${fmt(Math.max(...p), 1)} hPa. ${day.rainIn > 0 ? `${fmt(day.rainIn, 2)} inches of rain fell.` : 'No rain fell.'} The wind blows at ${fmt(day.hours[14].windMs, 1)} m/s in mid-afternoon.`}
    >
      <text className="ax" x={X0} y={14}>
        Temperature and dew point, °F
      </text>
      <GridY y={ty} ticks={niceTicks(lo, hi, 4)} x0={X0} x1={X1} format={(v) => `${v}°`} />
      <line x1={X0} x2={X1} y1={ty(avg)} y2={ty(avg)} stroke="#8a8a8a" strokeWidth={1.5} strokeDasharray="2 3" />
      <line x1={X0} x2={X1} y1={ty(official)} y2={ty(official)} stroke="#333" strokeWidth={1.5} strokeDasharray="7 4" />
      <text className="ax ax-e" x={X1} y={ty(official) + (officialAbove ? -5 : 13)} style={{ fill: '#333' }}>
        official mean {fmt(official, 1)}°
      </text>
      <text className="ax ax-e" x={X1 - 150} y={ty(avg) + (officialAbove ? 13 : -5)}>
        24-hour average {fmt(avg, 1)}°
      </text>
      <path d={linePath(dew.map((_, i) => X(i)), dew.map(ty))} fill="none" stroke={DEW} strokeWidth={2} />
      <path d={linePath(t.map((_, i) => X(i)), t.map(ty))} fill="none" stroke={TEMP} strokeWidth={2.75} strokeLinejoin="round" />
      <circle cx={X(iMax)} cy={ty(day.trueMax)} r={5} fill={TEMP} stroke="#fcfcfb" strokeWidth={2} />
      <text x={X(iMax)} y={ty(day.trueMax) - 9} textAnchor="middle" className="lab" style={{ fill: TEXT.red }}>
        max {fmt(day.trueMax, 1)}°
      </text>
      <circle cx={X(iMin)} cy={ty(day.trueMin)} r={5} fill={TEMP} stroke="#fcfcfb" strokeWidth={2} />
      <text x={X(iMin)} y={ty(day.trueMin) + 18} textAnchor="middle" className="lab" style={{ fill: TEXT.red }}>
        min {fmt(day.trueMin, 1)}°
      </text>

      <text className="ax" x={X0} y={214}>
        Pressure, hPa · rain, inches per hour
      </text>
      {day.hours.map((h) =>
        h.rainIn > 0 ? <rect key={h.hour} x={X(h.hour) - 9} y={292 - rainH(h.rainIn)} width={18} height={rainH(h.rainIn)} fill={tint(DEW, 0.55)} /> : null,
      )}
      <GridY y={py} ticks={niceTicks(p0, p1, 2)} x0={X0} x1={X1} format={(v) => fmt(v)} />
      <path d={linePath(p.map((_, i) => X(i)), p.map(py))} fill="none" stroke={GRAPHIC.blue} strokeWidth={2.25} />
      {day.rainIn > 0 && (
        <text className="ax ax-e" x={X1} y={226} style={{ fill: TEXT.teal }}>
          {fmt(day.rainIn, 2)} in of rain
        </text>
      )}

      <text className="ax" x={X0} y={318}>
        Wind, m/s
      </text>
      {day.hours
        .filter((h) => h.hour % 2 === 0)
        .map((h) => (
          <g key={h.hour}>
            <WindArrow x={X(h.hour)} y={338} from={h.windFrom} speed={h.windMs} />
            {h.hour % 6 === 0 && (
              <text x={X(h.hour)} y={362} textAnchor="middle" className="ax" style={{ fill: TEXT.violet }}>
                {fmt(h.windMs, 1)}
              </text>
            )}
          </g>
        ))}
      {HOUR_TICKS.map((h) => (
        <text key={h} className="ax ax-m" x={X(h)} y={380}>
          {hour(h)}
        </text>
      ))}
    </svg>
  );
}

function FaultChart({ day, f }: { day: StationDay; f: Faults }) {
  const t = day.hours.map((h) => h.trueF);
  const r = readCurve(day, f);
  const rec = recorded(day, f);
  const { doy } = dayInfo(day.d);
  const [lo, hi] = niceDomain(Math.min(...t, ...r) - 1, Math.max(...t, ...r) + 3, 4);
  const y = scale(lo, hi, 212, 30);
  const step = X(1) - X(0);
  const iMax = argmax(r);
  const iMin = argmin(r);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 240"
      role="img"
      aria-label={`A clear day at Calder Bay (simulated). The air’s true maximum is ${fmt(day.trueMax, 1)} °F and minimum ${fmt(day.trueMin, 1)} °F. With these faults the sensor records a maximum of ${fmt(rec.max, 1)} °F and a minimum of ${fmt(rec.min, 1)} °F, so its daily mean is ${signed(rec.mean - day.officialMeanF, 2)} °F off the true official mean.`}
    >
      {day.hours.map((h) => {
        const night = heatIslandWeight(h.hour, doy);
        const fill = h.sun > 0.001 ? tint(GRAPHIC.gold, 0.12 + 0.3 * h.sun) : tint(GRAPHIC.blue, 0.06 + 0.12 * night);
        return <rect key={h.hour} x={X(h.hour) - step / 2} y={30} width={step} height={182} fill={fill} />;
      })}
      <text className="ax" x={X0} y={14}>
        Temperature, °F · gold: sunshine on the sensor · blue: night
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={X0} x1={X1} format={(v) => `${v}°`} />
      <path d={linePath(t.map((_, i) => X(i)), t.map(y))} fill="none" stroke="#8a8a8a" strokeWidth={2} />
      <path d={linePath(r.map((_, i) => X(i)), r.map(y))} fill="none" stroke={TEMP} strokeWidth={2.75} strokeLinejoin="round" />
      <circle cx={X(iMax)} cy={y(rec.max)} r={5} fill={TEMP} stroke="#fcfcfb" strokeWidth={2} />
      <text x={X(iMax)} y={y(rec.max) - 9} textAnchor="middle" className="lab" style={{ fill: TEXT.red }}>
        recorded max {fmt(rec.max, 1)}°
      </text>
      <circle cx={X(iMin)} cy={y(rec.min)} r={5} fill={TEMP} stroke="#fcfcfb" strokeWidth={2} />
      <text x={Math.max(X0 + 60, X(iMin))} y={y(rec.min) + 18} textAnchor="middle" className="lab" style={{ fill: TEXT.red }}>
        recorded min {fmt(rec.min, 1)}°
      </text>
      {HOUR_TICKS.map((h) => (
        <text key={h} className="ax ax-m" x={X(h)} y={232}>
          {hour(h)}
        </text>
      ))}
    </svg>
  );
}

/** Root-mean-square and largest gap between the 24-hour average and the official mean in a month, over all the archive's years. */
function gapStats(month: number) {
  let s2 = 0;
  let n = 0;
  let mx = 0;
  for (let y = 1; y <= YEARS; y++) {
    const { start, days } = monthDays(y, month);
    for (let i = 0; i < days; i++) {
      const d = trueDay(start + i);
      const g = d.hourlyMeanF - d.officialMeanF;
      s2 += g * g;
      n++;
      mx = Math.max(mx, Math.abs(g));
    }
  }
  return { rms: Math.sqrt(s2 / n), max: mx };
}

export default function Lesson() {
  const s = useScenario('station', STATION_DEFAULTS);
  const st = s.state;
  const dom = Math.min(st.dom, MONTH_DAYS[st.month]);
  const day = trueDay(dayOf(st));
  const gap = day.hourlyMeanF - day.officialMeanF;
  const solved = gapSolved(st);
  const rh = day.hours.map((h) => h.rh);

  const fs = useScenario('faults', FAULT_DEFAULTS);
  const f: Faults = { unshielded: fs.state.unshielded, heatIsland: fs.state.heatIsland, drift: fs.state.drift };
  const ex = trueDay(EXAMPLE_DAYS[fs.state.example]);
  const rec = recorded(ex, f);
  const { unshielded, heatIsland, drift } = fs.state;
  const janBias = useMemo(() => monthBias(0, { unshielded, heatIsland, drift }), [unshielded, heatIsland, drift]);
  const julBias = useMemo(() => monthBias(6, { unshielded, heatIsland, drift }), [unshielded, heatIsland, drift]);
  const solved2 = f.unshielded === SHIELD_FAULT && f.heatIsland === 0 && Math.abs(janBias.mean) < BIAS_TOLERANCE;

  // Numbers the prose quotes.
  const ref = trueDay(dayOf(STATION_DEFAULTS));
  const refT = ref.hours.map((h) => h.trueF);
  const refRh = ref.hours.map((h) => h.rh);
  const refP = ref.hours.map((h) => h.pressureHpa);
  const janGap = useMemo(() => gapStats(0), []);
  const julGap = useMemo(() => gapStats(6), []);
  const shield = useMemo(() => ({ jan: monthBias(0, { ...NO_FAULTS, unshielded: SHIELD_FAULT }), jul: monthBias(6, { ...NO_FAULTS, unshielded: SHIELD_FAULT }) }), []);
  const heat = useMemo(() => ({ jan: monthBias(0, { ...NO_FAULTS, heatIsland: 2 }), jul: monthBias(6, { ...NO_FAULTS, heatIsland: 2 }) }), []);

  const caption = `Relative humidity runs from ${pct(Math.min(...rh))} at ${hour(argmin(rh))} to ${pct(Math.max(...rh))} at ${hour(argmax(rh))}, while the dew point stays near ${fmt(day.hours[12].dewF)} °F. ${
    day.rainIn > 0 ? `${fmt(day.rainIn, 2)} inches of rain fell, and the clouds held the day’s range to ${fmt(day.trueMax - day.trueMin, 1)} °F.` : `No rain fell; the day’s range was ${fmt(day.trueMax - day.trueMin, 1)} °F.`
  }`;

  return (
    <LessonPage id="weather/3.1">
      <P>
        <a href={lessonHref('weather/2.5')}>Lesson 2.5</a> ended with a distinction. A place’s climate says what a January can bring: the spread of its days,
        the depth of its tails. It can’t say what next Tuesday will bring. To forecast a particular day we need to know the state of the atmosphere now — where the
        cold air is, where the moisture is, how fast it’s all moving — and then work out how that state will change. This chapter asks how far that can go, for
        a system whose physics we know well but which, as we’ll see, never quite lets itself be predicted. It starts where every forecast starts: with measurements.
      </P>
      <P>
        The most basic is a surface weather station, like the one whose record we watched as a front passed Calder Bay in{' '}
        <a href={lessonHref('weather/2.2')}>Lesson 2.2</a>. Its thermometer and humidity sensor sit inside a shelter that shades them from the sun and lets air
        flow through, between about 1.25 and 2 m above level, grassy ground and away from buildings, so they measure the air rather than the sunshine or the
        nearest wall. A barometer measures the <K tone={WX.pressure}>pressure</K>. An anemometer and a wind vane stand on a mast 10 m up, above the slowing drag
        of the ground, and a rain gauge catches the <K tone={WX.moisture}>precipitation</K>. The stations that weather contracts settle on are typically automated
        ones at airports, which report around the clock.
      </P>
      <P>
        One convention matters more than any instrument for this course. In the United States, a day’s mean <K tone={WX.temperature}>temperature</K> is not the
        average of its readings. It is the average of just two of them, the day’s maximum and its minimum: (max + min) ÷ 2. That is the number the climate records
        keep, and it is the number weather contracts settle on.
      </P>
      <P>
        In the next demonstration, choose any day in the 41 years of the course’s simulated archive, and see the 24 hours that Calder Bay’s airport station
        recorded. The top panel is the temperature, in red, and the dew point, in teal, with the day’s maximum and minimum marked. The dashed line is the official
        daily mean, (max + min) ÷ 2, and the dotted one the plain average of the 24 hourly readings. Below are the pressure, the rain and the wind, the arrows
        pointing the way it blows:
      </P>

      <Figure name="Virtual Weather Station" scenario={s}>
        <DayChart day={day} st={st} />
        <Legend
          items={[
            { label: 'Temperature', color: TEMP, kind: 'line' },
            { label: 'Dew point', color: DEW, kind: 'line' },
            { label: 'Official mean', color: '#333', kind: 'line', dashed: true },
            { label: '24-hour average', color: '#8a8a8a', kind: 'line', dashed: true },
            { label: 'Pressure', color: GRAPHIC.blue, kind: 'line' },
            { label: 'Rain', color: tint(DEW, 0.55) },
            { label: 'Wind', color: GRAPHIC.violet },
          ]}
        />
        <Readouts
          items={[
            { label: 'maximum', value: `${fmt(day.trueMax, 1)} °F`, tone: WX.temperature },
            { label: 'minimum', value: `${fmt(day.trueMin, 1)} °F`, tone: WX.temperature },
            { label: 'official mean, (max + min) ÷ 2', value: `${fmt(day.officialMeanF, 2)} °F`, tone: WX.temperature },
            { label: '24-hour average', value: `${fmt(day.hourlyMeanF, 2)} °F` },
          ]}
        />
        <Slider label="Year" value={st.year} min={1} max={YEARS} onChange={(v) => s.set({ year: v })} display={`year ${st.year}`} />
        <Slider label="Month" value={st.month} min={0} max={11} onChange={(v) => s.set({ month: v })} display={MONTH_NAMES[st.month]} />
        <Slider label="Day" value={dom} min={1} max={31} onChange={(v) => s.set({ dom: v })} display={`${dom}`} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        The demonstration starts on January 12 of year 20, a clear winter day. The temperature bottoms out at {fmt(ref.trueMin, 1)} °F at{' '}
        {hour(argmin(refT))}, just before sunrise, after a long night of the ground radiating its heat to a clear sky, and peaks at {fmt(ref.trueMax, 1)} °F at{' '}
        {hour(argmax(refT))}, well after the sun is highest, because the ground goes on warming the air as long as it gains more energy than it loses. The dew point
        hardly moves, since nothing adds or removes water, so the relative humidity swings the other way, from {pct(Math.max(...refRh))} at dawn to{' '}
        {pct(Math.min(...refRh))} in mid-afternoon — the effect of <a href={lessonHref('weather/1.3')}>Lesson 1.3</a>, measured. The pressure drifts down
        through the day, from {fmt(refP[0], 1)} to {fmt(refP[23], 1)} hPa, as a weather system approaches, with a small ripple on top: the atmosphere’s tide, a
        twice-daily swing of pressure driven by the sun’s heating that peaks around 10:00 and 22:00. The wind is lightest at night and picks up in the afternoon,
        when the heated ground stirs the lowest kilometer and mixes faster-moving air down from above. Try a rainy day: the clouds roughly halve the temperature’s
        swing, by day blocking the sun and by night sending infrared back down, as in <a href={lessonHref('weather/1.1')}>Lesson 1.1</a>.
      </P>
      <P>
        Now compare the two lines through the middle of the top panel. On most days they nearly coincide. Across all 41 Januaries in the archive, the official mean
        and the 24-hour average differ by {fmt(janGap.rms, 1)} °F on a typical day (the root-mean-square difference), and never by more than{' '}
        {fmt(janGap.max, 1)} °F; in July the typical gap is {fmt(julGap.rms, 1)} °F. But they are different numbers. The official mean doesn’t care when the day
        was warm or for how long, only how high and how low it went. Here, the gap is {fmt(Math.abs(gap), 2)} °F, with the{' '}
        {gap >= 0 ? '24-hour average' : 'official mean'} the warmer.
      </P>

      <Challenge
        id="a"
        question="Find a winter day — in December, January or February — on which the official mean comes out at least 0.25 °F colder than the 24-hour average."
        solved={solved}
        status={
          !WINTER_MONTHS.includes(st.month)
            ? `${MONTH_NAMES[st.month]} isn’t a winter month.`
            : `On ${dateLabel(st)}, the 24-hour average is ${gap >= 0 ? `${fmt(gap, 2)} °F warmer` : `${fmt(-gap, 2)} °F colder`} than the official mean. Try days when the weather is warming up from one day to the next.`
        }
        success={`Solved. On ${dateLabel(st)} the 24-hour average is ${fmt(gap, 2)} °F warmer than the official ${fmt(day.officialMeanF, 2)} °F. The day was warming through. At this simulated station the arriving warmth holds the evening hours close to the day’s maximum, while the minimum comes early, so more of the day’s hours sit above the midpoint of the two. A contract that settles on the official mean settles on ${fmt(day.officialMeanF, 2)} °F all the same — the definition, not the air, decides the number.`}
      />

      <H2>When the instrument lies</H2>
      <P>
        A measurement is only as good as the instrument and the place it stands. Three faults are common enough to have names. A thermometer that loses the
        shade of its shelter is heated by the sunshine falling on it, and reads warmer than the air, most of all at midday on clear days. A thermometer near
        paving, a wall or a parking lot is warmed after dark by the heat those surfaces soaked up during the day — the urban heat island in miniature, strongest
        on long, calm nights. And any sensor can drift out of calibration, adding the same small error to every reading until someone checks it.
      </P>
      <P>
        In the next demonstration the gray line is the air’s true temperature on a clear day from the archive and the red line is what a faulty sensor records.
        The hours are shaded gold where sunshine reaches the sensor and blue at night, darker where a nearby heat source has had longer to release its warmth.
        The readouts also average each fault’s effect on the official daily mean over every January and every July in the archive. Choose a day and add faults:
      </P>

      <Figure name="Virtual Weather Station · instrument faults" scenario={fs}>
        <Segmented
          label="Example day"
          value={fs.state.example}
          onChange={(v) => fs.set({ example: v })}
          options={[
            { value: 'january', label: 'A clear January day' },
            { value: 'july', label: 'A clear July day' },
          ]}
        />
        <FaultChart day={ex} f={f} />
        <Legend
          items={[
            { label: 'True air temperature', color: '#8a8a8a', kind: 'line' },
            { label: 'What the sensor records', color: TEMP, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'recorded max, error', value: `${signed(rec.max - ex.trueMax, 2)} °F`, tone: WX.temperature },
            { label: 'recorded min, error', value: `${signed(rec.min - ex.trueMin, 2)} °F`, tone: WX.temperature },
            { label: 'this day’s official mean, error', value: `${signed(rec.mean - ex.officialMeanF, 2)} °F`, tone: WX.temperature },
            { label: 'every January, average error', value: `${signed(janBias.mean, 2)} °F` },
            { label: 'every July, average error', value: `${signed(julBias.mean, 2)} °F` },
          ]}
        />
        <Slider
          label="Unshielded sensor, warming in full sun"
          tone={WX.temperature}
          value={f.unshielded}
          min={0}
          max={6}
          step={0.5}
          onChange={(v) => fs.set({ unshielded: v })}
          display={`+${fmt(f.unshielded, 1)} °F`}
        />
        <Slider
          label="Heat source nearby, warming at night"
          tone={WX.temperature}
          value={f.heatIsland}
          min={0}
          max={4}
          step={0.5}
          onChange={(v) => fs.set({ heatIsland: v })}
          display={`+${fmt(f.heatIsland, 1)} °F`}
        />
        <Slider label="Calibration offset" value={f.drift} min={-1} max={1} step={0.05} onChange={(v) => fs.set({ drift: v })} display={`${signed(f.drift, 2)} °F`} />
      </Figure>

      <P>
        Each fault strikes at a particular time of day, so each shifts one end of the day more than the other, and the season decides how much. Take away the
        shield, with 3 °F of warming in full sun, and July’s recorded maximum comes out {fmt(shield.jul.max, 1)} °F too warm on average, January’s only{' '}
        {fmt(shield.jan.max, 1)} °F: at 41° north the winter sun is low and the days are short, and by the time the afternoon maximum comes the sunshine on the
        sensor is weak. A heat source worth 2 °F does the opposite. It raises January’s recorded minimum by {fmt(heat.jan.min, 1)} °F, because the long winter
        night gives it time to build and the minimum comes before dawn, but July’s by only {fmt(heat.jul.min, 1)} °F: summer nights are short, and the coolest
        reading comes after sunrise, when the warmth has faded. Since the official mean is half the maximum plus half the minimum, a fault that touches only one
        end moves the mean by about half as much. A calibration offset moves everything equally.
      </P>

      <Challenge
        id="b"
        question="A station’s shield has blown off, so its sensor gains 3 °F in full sun. Someone who checks it only against January’s records decides to correct it with a calibration offset. Find the offset that makes the average January daily mean come out right, to within 0.05 °F."
        solved={solved2}
        status={
          f.unshielded !== SHIELD_FAULT || f.heatIsland !== 0
            ? 'Set the unshielded sensor to +3.0 °F and the heat source to zero.'
            : `With an offset of ${signed(f.drift, 2)} °F, January’s daily means average ${signed(janBias.mean, 2)} °F off.`
        }
        success={`Solved: an offset of ${signed(f.drift, 2)} °F cancels January’s average error. But look at July: its daily means are still ${signed(julBias.mean, 2)} °F off, because the fault grows with the sunshine and the correction doesn’t. A fixed offset can’t repair an error that changes with the season; only fixing the shield can.`}
      />

      <P>
        Errors of a degree or less look trivial next to a day that swings 10 or 15 °F. But they don’t average away. A missing shield adds its error every sunny day,
        always in the same direction, and anything built by adding up daily means — a month’s, a season’s — adds up the error with them. Long records have
        quieter problems too: a station moved across an airfield, a new type of sensor, a city growing up around an instrument that never moved. Each can put a
        step or a slow drift into a record that has nothing to do with the weather, and climatologists spend a great deal of effort finding and adjusting them. A
        contract that pays on a station’s readings has to say exactly which station counts, and later in the course we’ll see that instrument problems like the
        ones in <FigRef to="Virtual Weather Station · instrument faults">this demonstration</FigRef> become money problems.
      </P>
      <P>
        A station, however good, measures one point. Between Calder Bay’s airport and Marlow, 350 km away, lie fields, hills and storms that no thermometer
        touches, and over the ocean there are almost no stations at all. To see what lies between them — the rain falling 50 km away, the cloud tops over the
        sea — we need instruments that measure from a distance. The next lesson turns to radar and satellites.
      </P>
    </LessonPage>
  );
}
