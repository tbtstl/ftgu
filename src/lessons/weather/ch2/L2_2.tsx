import { useId, useMemo } from 'react';
import {
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
  lessonHref,
  linePath,
  scale,
  tint,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { FRONT_SHAPE, frontPassage, frontWeather, type FrontInput, type FrontKind, type FrontWeather, type StationHour } from '../../../engines/weather/fronts';
import { density } from '../../../engines/weather/thermo';
import { STATIONS, type StationId } from '../../../model/weather/region';
import { FenwickMap } from '../shared/FenwickMap';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The first demonstration: one front, in cross-section and on Fenwick Bay's instruments.

export const FRONT_DEFAULTS: FrontInput = { kind: 'cold', coldC: 2, warmC: 16, warmDewC: 12, speed: 10 };

/** The front the engine sees: the dew point can't pass the warm air's temperature, and the cold air stays at least 1 °C colder. */
export function effectiveFront(f: FrontInput): FrontInput {
  return { ...f, warmDewC: Math.min(f.warmDewC, f.warmC), coldC: Math.min(f.coldC, f.warmC - 1) };
}

/** How much the pressure rises in the two hours after its lowest point, hPa. */
export function pressureJump(rec: StationHour[]): number {
  const k = rec.reduce((best, h, i) => (h.pressureHpa < rec[best].pressureHpa ? i : best), 0);
  return rec[Math.min(rec.length - 1, k + 2)].pressureHpa - rec[k].pressureHpa;
}

/** The first challenge: one cold front that leaves at least 10 mm of rain at Fenwick Bay. */
export const RAIN_TARGET_MM = 10;
export function rainSolved(f: FrontInput): boolean {
  const e = effectiveFront(f);
  return e.kind === 'cold' && frontWeather(e).rainMm >= RAIN_TARGET_MM;
}

/** The least whole-degree dew point at which the starting cold front leaves 10 mm, with the warm air at least that warm. */
export function leastRainDewC(): number {
  for (let d = FRONT_DEFAULTS.warmDewC; d <= 40; d++) {
    if (rainSolved({ ...FRONT_DEFAULTS, warmC: Math.max(d, FRONT_DEFAULTS.warmC), warmDewC: d })) return d;
  }
  return NaN;
}

const COLD_FILL = tint(GRAPHIC.blue, 0.22);
const WARM_FILL = tint(GRAPHIC.red, 0.1);
const CLOUD = '#e9ecef';
const CLOUD_EDGE = '#c9d0d6';

const XS = (km: number) => 330 + km * 0.7;
const ZS = (zKm: number) => 176 - zKm * 25;
const Z_TOP = 6;

/** Height of the frontal surface above the ground, km east of the surface front (negative = west). */
function surfaceAt(kind: FrontKind, slope: number, km: number) {
  return kind === 'cold' ? (km < 0 ? -km * slope : 0) : km > 0 ? km * slope : 0;
}

function Arrowhead({ x, y, angle, color }: { x: number; y: number; angle: number; color: string }) {
  const a = (angle * Math.PI) / 180;
  const p = (dx: number, dy: number) => `${x + dx * Math.cos(a) - dy * Math.sin(a)},${y + dx * Math.sin(a) + dy * Math.cos(a)}`;
  return <polygon points={`${p(0, 0)} ${p(-9, -5)} ${p(-9, 5)}`} fill={color} />;
}

function CrossSection({ f, wx }: { f: FrontInput; wx: FrontWeather }) {
  const cold = f.kind === 'cold';
  const slope = FRONT_SHAPE[f.kind].slope;
  const kms = Array.from({ length: 161 }, (_, i) => -400 + i * 5);
  const surf = kms.map((km) => Math.min(Z_TOP, surfaceAt(f.kind, slope, km)));
  // The cold air: everything under the frontal surface on its side.
  const wedgeKms = cold ? kms.filter((k) => k <= 0) : kms.filter((k) => k >= 0);
  const wedgeTop = wedgeKms.map((k) => Math.min(Z_TOP, surfaceAt(f.kind, slope, k)));
  const wedge =
    linePath(
      wedgeKms.map(XS),
      wedgeTop.map(ZS),
    ) + ` L${XS(wedgeKms[wedgeKms.length - 1])} ${ZS(0)} L${XS(wedgeKms[0])} ${ZS(0)} Z`;
  const base = wx.cloudBaseM / 1000;
  const top = wx.cloudTopM / 1000;
  // The cloud and the rain band.
  const [b0, b1] = cold ? [-FRONT_SHAPE.cold.bandKm * (2 / 3), FRONT_SHAPE.cold.bandKm / 3] : [0, FRONT_SHAPE.warm.bandKm];
  let cloud: string;
  let rainTop: (km: number) => number;
  if (cold) {
    const c0 = XS(b0 - 10);
    const c1 = XS(b1 + 10);
    cloud = `M${c0} ${ZS(base)} L${c1} ${ZS(base)} L${c1} ${ZS(Math.min(Z_TOP, top))} L${c0} ${ZS(Math.min(Z_TOP, top))} Z`;
    rainTop = () => base;
  } else {
    const deckKm = Array.from({ length: 48 }, (_, i) => -20 + i * 10);
    const lo = deckKm.map((k) => Math.max(base, surfaceAt('warm', slope, k) + 0.15));
    const hi = deckKm.map((k, i) => Math.max(lo[i] + 0.25, Math.min(Z_TOP, top + k * slope * 0.6 - (k > 300 ? (k - 300) * 0.01 : 0))));
    cloud = linePath(deckKm.map(XS), hi.map(ZS)) + ' ' + [...deckKm].reverse().map((k, i) => `L${XS(k)} ${ZS(lo[lo.length - 1 - i])}`).join(' ') + ' Z';
    rainTop = (km) => Math.max(base, surfaceAt('warm', slope, km) + 0.15);
  }
  const rainLines = [];
  for (let k = b0 + 4; k < b1; k += cold ? 6 : 18) rainLines.push(k);
  const raining = wx.rainRateMmH > 0.01;
  // Warm air riding up the frontal surface.
  const rideKm = cold ? [140, 60, 10, -20, -60, -110] : [-180, -90, 0, 120, 240, 360];
  const ride = rideKm.map((k) => {
    const z = cold ? (k > 0 ? 0.35 : Math.min(Z_TOP - 0.4, surfaceAt('cold', slope, k) + 0.5 + -k * 0.012)) : k < 0 ? 0.35 : surfaceAt('warm', slope, k) + 0.35;
    return [XS(k), ZS(z)] as const;
  });
  const last = ride[ride.length - 1];
  const prev = ride[ride.length - 2];
  const ang = (Math.atan2(last[1] - prev[1], last[0] - prev[0]) * 180) / Math.PI;
  const ahead = cold ? 'warm' : 'cold';
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 214"
      role="img"
      aria-label={`Cross-section of a ${f.kind} front moving east at ${fmt(f.speed, 1)} m/s. ${cold ? 'Cold air behind it, at' : 'Cold air ahead of it, at'} ${fmt(f.coldC)} °C, lies under warm air at ${fmt(f.warmC)} °C with a dew point of ${fmt(f.warmDewC)} °C. The frontal surface rises 1 km every ${fmt(1 / slope)} km and lifts the warm air at ${fmt(wx.liftMs * 100)} cm/s; it forms cloud from ${fmt(wx.cloudBaseM)} m and rains ${fmt(wx.rainRateMmH, 1)} mm an hour over a band ${fmt(wx.bandKm)} km wide.`}
    >
      <rect x={XS(-400)} y={ZS(Z_TOP)} width={XS(400) - XS(-400)} height={ZS(0) - ZS(Z_TOP)} fill={WARM_FILL} />
      <path d={wedge} fill={COLD_FILL} />
      <path d={linePath(kms.map(XS), surf.map(ZS))} fill="none" stroke={cold ? GRAPHIC.blue : GRAPHIC.red} strokeWidth={2.5} />
      <path d={cloud} fill={CLOUD} stroke={CLOUD_EDGE} strokeWidth={1} opacity={0.95} />
      {raining &&
        rainLines.map((k) => (
          <line key={k} x1={XS(k)} x2={XS(k) - 3} y1={ZS(rainTop(k)) + 3} y2={ZS(0) - 2} stroke={GRAPHIC.teal} strokeWidth={1.3} strokeDasharray="4 4" opacity={0.8} />
        ))}
      <path d={linePath(ride.map((p) => p[0]), ride.map((p) => p[1]))} fill="none" stroke={GRAPHIC.red} strokeWidth={2} strokeDasharray="6 4" />
      <Arrowhead x={last[0]} y={last[1]} angle={ang} color={GRAPHIC.red} />
      <line className="base" x1={XS(-400)} x2={XS(400)} y1={ZS(0)} y2={ZS(0)} />
      <line x1={XS(0)} x2={XS(0)} y1={ZS(0)} y2={ZS(0) + 6} stroke="#333" strokeWidth={2} />
      <text className="ax ax-m" x={XS(0)} y={ZS(0) + 18}>
        surface front
      </text>
      {[-400, -200, 200, 400].map((k) => (
        <text key={k} className="ax ax-m" x={XS(k) + (k === -400 ? 12 : k === 400 ? -12 : 0)} y={ZS(0) + 18}>
          {k > 0 ? `+${k}` : `−${-k}`} km
        </text>
      ))}
      <text x={cold ? XS(-380) : XS(380)} y={ZS(0.45)} textAnchor={cold ? 'start' : 'end'} style={{ fontSize: 13, fontWeight: 600, fill: TEXT.blue }}>
        cold air · {fmt(f.coldC)} °C
      </text>
      <text x={cold ? XS(380) : XS(-380)} y={ZS(Z_TOP - 0.5)} textAnchor={cold ? 'end' : 'start'} style={{ fontSize: 13, fontWeight: 600, fill: TEXT.red }}>
        {ahead === 'warm' ? 'warm air ahead' : 'warm air behind'} · {fmt(f.warmC)} °C, dew point {fmt(Math.min(f.warmDewC, f.warmC))} °C
      </text>
      <text x={XS(cold ? 30 : 330)} y={ZS(base) + (cold ? 14 : -6)} className="ax" textAnchor={cold ? 'start' : 'middle'} style={{ fill: TEXT.teal }}>
        cloud base {fmt(wx.cloudBaseM)} m
      </text>
      <text x={XS(0)} y={14} textAnchor="middle" className="lab">
        moving east at {fmt(f.speed, 1)} m/s →
      </text>
      <text x={8} y={ZS(Z_TOP) + 4} className="ax">
        6 km
      </text>
      <text x={8} y={ZS(3) + 4} className="ax">
        3 km
      </text>
    </svg>
  );
}

const HX = scale(0, 48, 64, 620);

/** Fenwick Bay's instruments as the front passes, hour by hour. */
function StationRecord({ rec, f }: { rec: StationHour[]; f: FrontInput }) {
  const temps = rec.flatMap((h) => [h.tempC, h.dewC]);
  const t0 = Math.floor(Math.min(...temps) / 5) * 5;
  const t1 = Math.ceil(Math.max(...temps) / 5) * 5;
  const ty = scale(t0, t1 === t0 ? t0 + 5 : t1, 96, 22);
  const ps = rec.map((h) => h.pressureHpa);
  const p0 = Math.floor(Math.min(...ps) / 4) * 4;
  const p1 = Math.max(p0 + 8, Math.ceil(Math.max(...ps) / 4) * 4);
  const py = scale(p0, p1, 168, 120);
  const ry = scale(0, 10, 244, 204);
  const xs = rec.map((h) => HX(h.t));
  const total = rec.reduce((s, h) => s + h.rainMm, 0);
  const first = rec[0];
  const lastH = rec[rec.length - 1];
  const pMin = rec.reduce((a, h) => (h.pressureHpa < a.pressureHpa ? h : a), rec[0]);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 270"
      role="img"
      aria-label={`Fenwick Bay's station over 48 hours as the ${f.kind} front arrives at hour 24: temperature goes from ${fmt(first.tempC)} to ${fmt(lastH.tempC)} °C, dew point from ${fmt(first.dewC)} to ${fmt(lastH.dewC)} °C, pressure from ${fmt(first.pressureHpa)} hPa down to ${fmt(pMin.pressureHpa)} hPa at hour ${pMin.t} and then ${fmt(lastH.pressureHpa)} hPa, the wind from ${fmt(first.windFrom)}° to ${fmt(lastH.windFrom)}°, and ${fmt(total, 1)} mm of rain.`}
    >
      <text className="ax" x={64} y={12}>
        Temperature and dew point, °C
      </text>
      <GridY y={ty} ticks={[t0, (t0 + t1) / 2, t1].filter((v, i, a) => a.indexOf(v) === i)} x0={64} x1={620} format={(v) => fmt(v)} />
      <path d={linePath(xs, rec.map((h) => ty(h.dewC)))} fill="none" stroke={GRAPHIC.teal} strokeWidth={2} />
      <path d={linePath(xs, rec.map((h) => ty(h.tempC)))} fill="none" stroke={GRAPHIC.red} strokeWidth={2.5} />
      <text className="ax" x={64} y={112}>
        Pressure, hPa
      </text>
      <GridY y={py} ticks={[p0, p1]} x0={64} x1={620} format={(v) => fmt(v)} />
      <path d={linePath(xs, rec.map((h) => py(h.pressureHpa)))} fill="none" stroke={GRAPHIC.blue} strokeWidth={2.5} />
      <text className="ax" x={64} y={184}>
        Wind and rain, mm per hour
      </text>
      {rec
        .filter((h) => h.t % 3 === 0 && h.t > 0 && h.t < 48)
        .map((h) => {
          // Arrows point the way the wind blows: from windFrom toward the opposite direction.
          const to = ((h.windFrom + 180) * Math.PI) / 180;
          const dx = Math.sin(to) * 8;
          const dy = -Math.cos(to) * 8;
          const cx = HX(h.t);
          const cy = 196;
          return (
            <g key={h.t}>
              <line x1={cx - dx} y1={cy - dy} x2={cx + dx * 0.4} y2={cy + dy * 0.4} stroke={GRAPHIC.violet} strokeWidth={1.6} />
              <Arrowhead x={cx + dx} y={cy + dy} angle={(Math.atan2(dy, dx) * 180) / Math.PI} color={GRAPHIC.violet} />
            </g>
          );
        })}
      <line className="base" x1={64} x2={620} y1={ry(0)} y2={ry(0)} />
      {rec.map((h) =>
        h.rainMm > 0.005 ? (
          <rect key={h.t} x={HX(h.t - 1) + 1} y={ry(Math.min(10, h.rainMm))} width={HX(1) - HX(0) - 2} height={ry(0) - ry(Math.min(10, h.rainMm))} fill={GRAPHIC.teal} />
        ) : null,
      )}
      <line className="cur" x1={HX(24)} x2={HX(24)} y1={20} y2={ry(0)} />
      {[0, 12, 24, 36, 48].map((h) => (
        <text key={h} className="ax ax-m" x={HX(h)} y={262}>
          {h === 24 ? 'front arrives' : `${h} h`}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The second demonstration: a low and its two fronts crossing the region.

/** The low tracks east along the north edge of the map; positions in map units (≈ km). */
export const LOW = {
  y: 30,
  /** Where the low is at hour 0, km east of the map's west edge. */
  startX: -330,
  /** The warm front leaves the low heading 55° south of east; the cold front 20° west of south. */
  warmAngle: 55,
  coldAngle: 20,
};
const KW = 1 / Math.tan((LOW.warmAngle * Math.PI) / 180);
const KC = -Math.tan((LOW.coldAngle * Math.PI) / 180);
const DIR_W = { x: Math.cos((LOW.warmAngle * Math.PI) / 180), y: Math.sin((LOW.warmAngle * Math.PI) / 180) };
const DIR_C = { x: -Math.sin((LOW.coldAngle * Math.PI) / 180), y: Math.cos((LOW.coldAngle * Math.PI) / 180) };
/** Air in the region at each stage, °C (illustrative values). */
export const AIR = { ahead: 6, sector: 17, behind: -1 };
export const PASSAGE_HOURS = 60;
export const LOW_DEFAULTS = { speed: 10, hour: 18 };

export function lowX(hour: number, speed: number): number {
  return LOW.startX + speed * 3.6 * hour;
}

/** Where the two fronts cross a given line of latitude on the map (y), when the low is at x = lx. */
export function frontXs(lx: number, y: number): { warm: number; cold: number } {
  return { warm: lx + KW * (y - LOW.y), cold: lx + KC * (y - LOW.y) };
}

/** Hour at which the cold front reaches a station. */
export function coldArrivalHour(id: StationId, speed: number): number {
  const s = STATIONS[id];
  return (s.x - KC * (s.y - LOW.y) - LOW.startX) / (speed * 3.6);
}

/** Hours between the cold front reaching Marlow and reaching Fenwick Bay. */
export function coldLagHours(speed: number): number {
  return coldArrivalHour('fenwick', speed) - coldArrivalHour('marlow', speed);
}

/** The second challenge: Fenwick Bay's cold front 12 hours after Marlow's, to the nearest hour. */
export const LAG_TARGET_H = 12;
export function lagSolved(speed: number): boolean {
  return Math.round(coldLagHours(speed)) === LAG_TARGET_H;
}

export type AirStage = 'ahead' | 'sector' | 'behind';

/** What a station is experiencing at an hour: which air it's in, its temperature and any rain. */
export function stationAt(id: StationId, hour: number, speed: number): { stage: AirStage; tempC: number; rain: 'warm' | 'cold' | null } {
  const s = STATIONS[id];
  const { warm, cold } = frontXs(lowX(hour, speed), s.y);
  const sig = (v: number) => 1 / (1 + Math.exp(-v));
  const pastWarm = sig((warm - s.x) / (FRONT_SHAPE.warm.transitionKm / 4));
  const pastCold = sig((cold - s.x) / (FRONT_SHAPE.cold.transitionKm / 4));
  const tempC = AIR.ahead + (AIR.sector - AIR.ahead) * pastWarm + (AIR.behind - AIR.sector) * pastCold;
  const stage: AirStage = cold >= s.x ? 'behind' : warm >= s.x ? 'sector' : 'ahead';
  const inWarmBand = s.x - warm > 0 && s.x - warm <= FRONT_SHAPE.warm.bandKm;
  const inColdBand = cold - s.x >= -FRONT_SHAPE.cold.bandKm / 3 && cold - s.x <= (2 * FRONT_SHAPE.cold.bandKm) / 3;
  return { stage, tempC, rain: inColdBand ? 'cold' : inWarmBand ? 'warm' : null };
}

const STAGE_LABEL: Record<AirStage, string> = { ahead: 'cool air ahead of the warm front', sector: 'the warm sector', behind: 'cold air behind the cold front' };

function stageText(id: StationId, hour: number, speed: number) {
  const st = stationAt(id, hour, speed);
  return `${STAGE_LABEL[st.stage]}, ${fmt(st.tempC)} °C${st.rain === 'warm' ? ', steady rain' : st.rain === 'cold' ? ', showers' : ''}`;
}

/** Triangles (cold) or half-disks (warm) along a front, on the side it advances toward. */
function FrontLine({ x, y, dir, len, kind }: { x: number; y: number; dir: { x: number; y: number }; len: number; kind: FrontKind }) {
  const color = kind === 'cold' ? GRAPHIC.blue : GRAPHIC.red;
  // Normal pointing toward the side the front advances into (eastward).
  const n = { x: dir.y, y: -dir.x };
  const marks = [];
  for (let s = 20; s < len; s += 38) {
    const px = x + dir.x * s;
    const py = y + dir.y * s;
    if (kind === 'cold') {
      const a = `${px - dir.x * 7},${py - dir.y * 7}`;
      const b = `${px + dir.x * 7},${py + dir.y * 7}`;
      const c = `${px + n.x * 10},${py + n.y * 10}`;
      marks.push(<polygon key={s} points={`${a} ${b} ${c}`} fill={color} />);
    } else {
      const ax = px - dir.x * 7;
      const ay = py - dir.y * 7;
      const bx = px + dir.x * 7;
      const by = py + dir.y * 7;
      marks.push(<path key={s} d={`M${ax} ${ay} A7 7 0 0 0 ${bx} ${by} Z`} fill={color} />);
    }
  }
  return (
    <g>
      <line x1={x} y1={y} x2={x + dir.x * len} y2={y + dir.y * len} stroke={color} strokeWidth={3} />
      {marks}
    </g>
  );
}

function LowMap({ hour, speed }: { hour: number; speed: number }) {
  const clip = 'lowmap' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const lx = lowX(hour, speed);
  const L = { x: lx, y: LOW.y };
  const far = 700;
  const sector = `M${L.x} ${L.y} L${L.x + DIR_W.x * far} ${L.y + DIR_W.y * far} L${L.x + DIR_C.x * far} ${L.y + DIR_C.y * far} Z`;
  const wb = FRONT_SHAPE.warm.bandKm;
  const warmBand = `M${L.x} ${L.y} L${L.x + DIR_W.x * far} ${L.y + DIR_W.y * far} L${L.x + DIR_W.x * far + wb} ${L.y + DIR_W.y * far} L${L.x + wb} ${L.y} Z`;
  const cb0 = -(2 * FRONT_SHAPE.cold.bandKm) / 3;
  const cb1 = FRONT_SHAPE.cold.bandKm / 3;
  const coldBand = `M${L.x + cb0} ${L.y} L${L.x + DIR_C.x * far + cb0} ${L.y + DIR_C.y * far} L${L.x + DIR_C.x * far + cb1} ${L.y + DIR_C.y * far} L${L.x + cb1} ${L.y} Z`;
  const status = (id: StationId) => {
    const s = STATIONS[id];
    const st = stationAt(id, hour, speed);
    const left = id === 'fenwick';
    return (
      <text key={id} x={left ? s.x - 12 : s.x + 10} y={s.y + (id === 'ridge' ? 4 : 20)} textAnchor={left ? 'end' : 'start'} className="ax" style={{ fill: st.stage === 'sector' ? TEXT.red : TEXT.blue }}>
        {fmt(st.tempC)} °C{st.rain ? ' · rain' : ''}
      </text>
    );
  };
  return (
    <FenwickMap
      ariaLabel={`Map of the Fenwick region ${fmt(hour)} hours after a low entered from the west, moving east at ${fmt(speed, 1)} m/s along the region's northern edge. Marlow is in ${stageText('marlow', hour, speed)}; Fenwick Bay is in ${stageText('fenwick', hour, speed)}.`}
      overlay={
        <g>
          {(['marlow', 'ridge', 'fenwick'] as StationId[]).map(status)}
          <text x={592} y={20} textAnchor="end" className="lab">
            hour {fmt(hour)}
          </text>
        </g>
      }
    >
      <defs>
        <clipPath id={clip}>
          <rect x={0} y={0} width={600} height={400} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <path d={sector} fill={GRAPHIC.red} opacity={0.1} />
        <path d={warmBand} fill={GRAPHIC.teal} opacity={0.14} />
        <path d={coldBand} fill={GRAPHIC.teal} opacity={0.3} />
        <FrontLine x={L.x} y={L.y} dir={DIR_W} len={far} kind="warm" />
        <FrontLine x={L.x} y={L.y} dir={DIR_C} len={far} kind="cold" />
        <circle cx={L.x} cy={L.y} r={13} fill="#fcfcfb" stroke={GRAPHIC.blue} strokeWidth={1.5} />
        <text x={L.x} y={L.y + 6} textAnchor="middle" style={{ fontSize: 17, fontWeight: 700, fill: TEXT.blue }}>
          L
        </text>
      </g>
    </FenwickMap>
  );
}

const PX = scale(0, PASSAGE_HOURS, 64, 620);

function PassageChart({ hour, speed }: { hour: number; speed: number }) {
  const hours = useMemo(() => Array.from({ length: PASSAGE_HOURS * 2 + 1 }, (_, i) => i / 2), []);
  const series = useMemo(
    () => (['marlow', 'fenwick'] as StationId[]).map((id) => ({ id, temps: hours.map((h) => stationAt(id, h, speed).tempC) })),
    [hours, speed],
  );
  const y = scale(-4, 20, 104, 18);
  const colors: Record<string, string> = { marlow: '#8a8a8a', fenwick: GRAPHIC.red };
  return (
    <svg
      className="chart"
      viewBox="0 0 640 128"
      role="img"
      aria-label={`Temperatures at Marlow and Fenwick Bay over ${PASSAGE_HOURS} hours as the low passes: each warms when the warm front passes and turns cold when the cold front does. The cold front reaches Marlow at hour ${fmt(coldArrivalHour('marlow', speed))} and Fenwick Bay at hour ${fmt(coldArrivalHour('fenwick', speed))}.`}
    >
      <text className="ax" x={64} y={12}>
        Temperature, °C
      </text>
      <GridY y={y} ticks={[0, 10, 20]} x0={64} x1={620} format={(v) => fmt(v)} baseline={0} />
      {series.map((s) => (
        <path key={s.id} d={linePath(hours.map(PX), s.temps.map(y))} fill="none" stroke={colors[s.id]} strokeWidth={s.id === 'fenwick' ? 2.5 : 2} strokeDasharray={s.id === 'marlow' ? '6 4' : undefined} />
      ))}
      <line className="cur" x1={PX(hour)} x2={PX(hour)} y1={18} y2={104} />
      {[0, 12, 24, 36, 48, 60].map((h) => (
        <text key={h} className="ax ax-m" x={PX(h)} y={122}>
          {h} h
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('front', FRONT_DEFAULTS);
  const f = effectiveFront(s.state);
  const wx = frontWeather(f);
  const rec = useMemo(() => frontPassage(f, 48, 24), [f.kind, f.coldC, f.warmC, f.warmDewC, f.speed]);
  const solved = rainSolved(s.state);
  const cold = f.kind === 'cold';

  const m = useScenario('passage', LOW_DEFAULTS);
  const { speed, hour } = m.state;
  const play = usePlay(true);
  useAnimationFrame((dt) => m.set((x) => ({ hour: x.hour + dt * 5 > PASSAGE_HOURS ? 0 : x.hour + dt * 5 })), play.playing);
  const lag = coldLagHours(speed);
  const solved2 = lagSolved(speed);

  // Numbers the prose quotes.
  const ref = frontWeather(FRONT_DEFAULTS);
  const refRec = frontPassage(FRONT_DEFAULTS, 48, 24);
  const refMin = refRec.reduce((a, h) => (h.pressureHpa < a.pressureHpa ? h : a), refRec[0]);
  const refWarm = frontWeather({ ...FRONT_DEFAULTS, kind: 'warm', speed: 5 });
  const refSlow = frontWeather({ ...FRONT_DEFAULTS, speed: 5 });
  const refFast = frontWeather({ ...FRONT_DEFAULTS, speed: 20 });
  const rhoCold = density(1000, FRONT_DEFAULTS.coldC);
  const rhoWarm = density(1000, FRONT_DEFAULTS.warmC);
  const hotter = frontWeather({ ...FRONT_DEFAULTS, warmC: 24 });
  const lagDefault = coldLagHours(LOW_DEFAULTS.speed);
  // The pressure's rise in the two hours after its lowest point, and the most rain a cold front can draw from the starting warm air.
  const refJump = pressureJump(refRec);
  const saturatedRain = frontWeather({ ...FRONT_DEFAULTS, warmDewC: FRONT_DEFAULTS.warmC }).rainMm;
  const fenwickWarm = (STATIONS.fenwick.x - KW * (STATIONS.fenwick.y - LOW.y) - LOW.startX) / (LOW_DEFAULTS.speed * 3.6);
  const fenwickCold = coldArrivalHour('fenwick', LOW_DEFAULTS.speed);

  return (
    <LessonPage id="weather/2.2">
      <P>
        <a href={lessonHref('weather/2.1')}>The previous lesson</a> divided each hemisphere into three great cells, and put Fenwick Bay’s 41° north in the
        westerlies, under the jet stream that runs above the boundary between cold polar air and warm subtropical air. That boundary isn’t a gentle gradient. Much
        of the time the change from one kind of air to the other is squeezed into a zone a few tens of kilometers wide, and that zone — a <b>front</b> — is where
        most of the mid-latitudes’ weather happens. The name comes from meteorologists in Bergen, Norway, who worked out the picture at the end of the First World
        War and borrowed the word from the battle lines of the time.
      </P>
      <P>
        The air on each side of a front is an <b>air mass</b>: a body of air, often more than a thousand kilometers across, that has sat over one kind of surface
        long enough to take on its <K tone={WX.temperature}>temperature</K> and its <K tone={WX.moisture}>moisture</K>. Air that lingers over a frozen continental
        interior turns cold and dry; air over a warm tropical sea turns warm and humid. Meteorologists name them by where they formed: continental or maritime,
        polar or tropical — continental polar air, maritime tropical air, and so on.
      </P>
      <P>
        Chapter 1 visited the course’s fictional region a few times; from here on we’ll follow it closely. The <b>Fenwick region</b> lies at about 41° north on
        the east coast of a continent. Its port city, <b>Fenwick Bay</b>, is where the weather contracts of later chapters will settle. About 350 km inland lies{' '}
        <b>Marlow</b>, the farm town on the corn plains of <a href={lessonHref('weather/1.4')}>Lesson 1.4</a>, and to the city’s north-west the hills of{' '}
        <b>Hollin Ridge</b> carry the region’s wind farm. Two air masses take turns over it.
        Continental polar air arrives from the north-west, cold and dry from the interior; maritime tropical air arrives from the south, warm and humid from the
        ocean. Where they meet, the colder air is the denser: at the same pressure, air at {fmt(FRONT_DEFAULTS.coldC)} °C is {fmt((rhoCold / rhoWarm - 1) * 100)}%
        denser than air at {fmt(FRONT_DEFAULTS.warmC)} °C (<a href={lessonHref('weather/1.2')}>Lesson 1.2</a>). So the cold air slides under the warm air like a
        wedge, and the warm air is forced up over it — cooling as it rises, until it reaches its dew point and makes cloud (
        <a href={lessonHref('weather/1.3')}>Lesson 1.3</a>).
      </P>
      <P>
        In the next demonstration, the upper picture is a slice through a front, west on the left, with the cold air shaded blue and the warm air riding up over it
        in red. The lower one is the record from Fenwick Bay’s weather station over two days as the front passes, arriving at hour 24. A <b>cold front</b> is one where
        the cold air advances and pushes the warm air out of the way; at a <b>warm front</b>, the warm air advances and climbs over the retreating cold air. Choose
        one, and change the two air masses and the front’s speed:
      </P>

      <Figure name="Weather Front Lab" scenario={s}>
        <Segmented
          label="Kind of front"
          value={s.state.kind}
          onChange={(v) => s.set({ kind: v })}
          options={[
            { value: 'cold', label: 'Cold front' },
            { value: 'warm', label: 'Warm front' },
          ]}
        />
        <CrossSection f={f} wx={wx} />
        <StationRecord rec={rec} f={f} />
        <Legend
          items={[
            { label: 'Temperature', color: GRAPHIC.red, kind: 'line' },
            { label: 'Dew point', color: GRAPHIC.teal, kind: 'line' },
            { label: 'Pressure', color: GRAPHIC.blue, kind: 'line' },
            { label: 'Wind direction', color: GRAPHIC.violet },
            { label: 'Rain', color: GRAPHIC.teal },
          ]}
        />
        <Readouts
          items={[
            { label: 'warm air lifted at', value: `${fmt(wx.liftMs * 100, wx.liftMs < 0.1 ? 1 : 0)} cm/s`, tone: WX.wind },
            { label: `of rain: ${fmt(wx.rainRateMmH, 1)} mm an hour for ${fmt(wx.rainHours, 1)} hours`, value: `${fmt(wx.rainMm, 1)} mm`, tone: WX.moisture },
            { label: 'higher pressure under the cold air', value: `${fmt(wx.domeHpa, 1)} hPa`, tone: WX.pressure },
          ]}
        />
        <Slider label="Cold air" tone={WX.temperature} value={s.state.coldC} min={-20} max={14} onChange={(v) => s.set({ coldC: v })} display={`${fmt(f.coldC)} °C`} />
        <Slider label="Warm air" tone={WX.temperature} value={s.state.warmC} min={4} max={32} onChange={(v) => s.set({ warmC: v })} display={`${fmt(f.warmC)} °C`} />
        <Slider
          label="Warm air’s dew point"
          tone={WX.moisture}
          value={s.state.warmDewC}
          min={-10}
          max={28}
          onChange={(v) => s.set({ warmDewC: v })}
          display={s.state.warmDewC > s.state.warmC ? `${fmt(f.warmDewC)} °C, saturated` : `${fmt(f.warmDewC)} °C`}
        />
        <Slider label="Front’s speed" tone={WX.wind} value={s.state.speed} min={2} max={20} step={0.5} onChange={(v) => s.set({ speed: v })} display={`${fmt(f.speed, 1)} m/s`} />
      </Figure>

      <P>
        Start with the cold front. Its nose is steep — in this model the frontal surface rises a kilometer for every {fmt(1 / FRONT_SHAPE.cold.slope)} km — so at{' '}
        {fmt(FRONT_DEFAULTS.speed)} m/s it shovels the warm air upward at {fmt(ref.liftMs * 100)} cm/s. The warm air’s dew point is 4 °C below its temperature,
        so it saturates about {fmt(ref.cloudBaseM)} m up, and a narrow band of cloud and rain forms along the front: {fmt(ref.rainRateMmH, 1)} mm an hour for{' '}
        {fmt(ref.rainHours, 1)} hours, {fmt(ref.rainMm, 1)} mm in all. On the station record the front is unmistakable. The temperature falls{' '}
        {fmt(FRONT_DEFAULTS.warmC - FRONT_DEFAULTS.coldC)} °C in about two hours, the dew point drops with it as the dry polar air arrives, and the wind swings
        from south-west to north-west. That clockwise turn is called a <b>veer</b>.
      </P>
      <P>
        Watch the pressure, too. It falls through the day as the front approaches, bottoming out at {fmt(refMin.pressureHpa, 1)} hPa as the front arrives, then
        jumps about {fmt(refJump)} hPa in two hours and keeps rising. The pressure at the ground is the weight of the air overhead, and behind the front the lowest
        1.5 km of the column is filled with colder, denser air, which weighs {fmt(ref.domeHpa, 1)} hPa more. A falling barometer has warned sailors of an
        approaching storm for centuries.
      </P>
      <P>
        Now switch to a warm front, and slow it to 5 m/s, a more typical pace for one. Its surface is far gentler, rising a kilometer in{' '}
        {fmt(1 / FRONT_SHAPE.warm.slope)} km, so the warm air glides up it at only {fmt(refWarm.liftMs * 100, 1)} cm/s. The rain is light,{' '}
        {fmt(refWarm.rainRateMmH, 1)} mm an hour, but it falls from a deck of cloud spread hundreds of kilometers ahead of the front, so it begins long before the warm
        air arrives and goes on for {fmt(refWarm.rainHours)} hours — {fmt(refWarm.rainMm)} mm, more than the cold front’s brief, harder rain.
      </P>

      <H2>What sets the rain</H2>
      <P>
        Rain is the water vapor carried up by the lifted air, less what it can still hold at the top of its climb. So the rain rate is the air’s density, times
        the speed at which it is lifted, times the grams of vapor each kilogram gives up. Speed up the cold front and the rate rises in proportion: at 5 m/s it
        rains {fmt(refSlow.rainRateMmH, 1)} mm an hour, at 20 m/s {fmt(refFast.rainRateMmH, 1)}. But a faster front also crosses the station sooner, and the two
        effects cancel exactly: {fmt(refSlow.rainMm, 1)} mm either way. Heating the warm air doesn’t help either. At 24 °C with the same 12 °C dew point, the air
        carries the same vapor and simply saturates higher up, and the front leaves the same {fmt(hotter.rainMm, 1)} mm. What changes the total is the moisture itself, the dew
        point.
      </P>

      <Challenge
        id="a"
        question={`Predict first: could the starting ${fmt(FRONT_DEFAULTS.warmC)} °C warm air make a cold front leave ${RAIN_TARGET_MM} mm of rain if only its dew point rose? Then make a single cold front leave at least ${RAIN_TARGET_MM} mm at Fenwick Bay.`}
        solved={solved}
        status={
          !cold
            ? 'Switch to a cold front first.'
            : s.state.warmDewC >= f.warmC
              ? `The warm air is saturated: at ${fmt(f.warmC)} °C it can hold no more vapor, and the front leaves ${fmt(wx.rainMm, 1)} mm.`
              : `Right now the cold front leaves ${fmt(wx.rainMm, 1)} mm: ${fmt(wx.rainRateMmH, 1)} mm an hour for ${fmt(wx.rainHours, 1)} hours.`
        }
        success={`Solved: ${fmt(wx.rainMm, 1)} mm, from warm air at ${fmt(f.warmC)} °C with a dew point of ${fmt(f.warmDewC)} °C. The dew point alone couldn’t do it, because it can’t rise past the air’s own temperature: at the starting ${fmt(FRONT_DEFAULTS.warmC)} °C, even saturated air leaves only ${fmt(saturatedRain, 1)} mm. It takes more water vapor, in air warm enough to hold it — here a dew point of at least ${fmt(leastRainDewC())} °C. That’s why the heaviest frontal rain at Fenwick Bay comes when the warm sector is filled with humid air straight off the ocean.`}
      />

      <H2>Fronts come in pairs</H2>
      <P>
        Fronts rarely travel alone. Recall the lows of <a href={lessonHref('weather/1.5')}>Lesson 1.5</a>, around which the wind circles counterclockwise in the
        Northern Hemisphere. On a low’s eastern side the wind blows from the south and drags warm air poleward; on its western side it blows from the north and
        drags cold air toward the equator. The boundary sharpens into two fronts that meet at the low: a warm front running east or south-east of it, a cold
        front trailing to its south-west, and between them a wedge of warm, humid air called the <b>warm sector</b>. This was the Bergen meteorologists’ great
        insight: the fronts and the low are one system, born together on the boundary between the air masses, and the whole system drifts east on the westerlies.
        The cold front usually moves faster, and eventually catches up with the warm front and lifts the warm sector off the ground altogether; the front they
        merge into is called an <b>occluded front</b>.
      </P>
      <P>
        In the next demonstration, such a low tracks east along the northern edge of the Fenwick region, with its warm front (red half-disks) and cold front (blue
        triangles) sweeping across the map. The rain bands are shaded teal and the warm sector red, and each station shows its temperature as the system passes. The
        chart compares the temperatures at Marlow and Fenwick Bay. Change the system’s speed, or drag the hour:
      </P>

      <Figure name="Weather Front Lab · a passing low" scenario={m} play={play}>
        <LowMap hour={hour} speed={speed} />
        <PassageChart hour={hour} speed={speed} />
        <Legend
          items={[
            { label: 'Fenwick Bay', color: GRAPHIC.red, kind: 'line' },
            { label: 'Marlow', color: '#8a8a8a', kind: 'line', dashed: true },
            { label: 'Warm sector', color: tint(GRAPHIC.red, 0.25) },
            { label: 'Rain', color: tint(GRAPHIC.teal, 0.45) },
          ]}
        />
        <Readouts
          items={[
            { label: 'Marlow', value: STAGE_LABEL[stationAt('marlow', hour, speed).stage].replace(/ (ahead of|behind) the .*$/, ''), tone: stationAt('marlow', hour, speed).stage === 'sector' ? WX.temperature : WX.pressure },
            { label: 'Fenwick Bay', value: STAGE_LABEL[stationAt('fenwick', hour, speed).stage].replace(/ (ahead of|behind) the .*$/, ''), tone: stationAt('fenwick', hour, speed).stage === 'sector' ? WX.temperature : WX.pressure },
          ]}
        />
        <Slider label="Hour" value={hour} min={0} max={PASSAGE_HOURS} step={0.5} onChange={(v) => m.set({ hour: v })} display={`hour ${fmt(hour)}`} />
        <Slider label="The system’s speed" tone={WX.wind} value={speed} min={5} max={15} step={0.5} onChange={(v) => m.set({ speed: v })} display={`${fmt(speed, 1)} m/s`} />
      </Figure>

      <P>
        Every station south of the low’s track lives through the same sequence. First the sky thickens and steady rain begins, long before the warm front itself
        arrives. Then the front passes, the rain stops and the temperature climbs as the mild, humid air of the warm sector flows in. Hours later the cold front
        brings a short burst of harder rain, and behind it the north-west wind and the cold, dry air. At {fmt(LOW_DEFAULTS.speed)} m/s, Fenwick Bay’s warm front
        arrives at hour {fmt(fenwickWarm)} and its cold front at hour {fmt(fenwickCold)}.
      </P>
      <P>
        And every station gets it in turn from the west. Marlow lives through each stage hours before Fenwick Bay does; at {fmt(LOW_DEFAULTS.speed)} m/s the cold
        front reaches the city {fmt(lagDefault, 1)} hours after the farm town. The wind that brings the weather also delivers a warning: what Marlow’s instruments
        record this morning, Fenwick Bay’s will record this evening. That simple idea — look upstream to see what’s coming — is where weather forecasting began, and
        we’ll build on it in Chapter 3. (The demonstration’s temperatures are illustrative: {fmt(AIR.ahead)} °C ahead of the warm front, {fmt(AIR.sector)} °C in the
        warm sector, {fmt(AIR.behind)} °C behind the cold front.)
      </P>

      <Challenge
        id="b"
        question={`A cold front passes Marlow at dawn. Predict first: at ${fmt(LOW_DEFAULTS.speed)} m/s it reaches Fenwick Bay ${fmt(lagDefault, 1)} hours later, and the lag is the distance divided by the speed. How fast must the system move for the front to reach the city ${LAG_TARGET_H} hours later, to the nearest hour? Work it out, then set that speed and check.`}
        solved={solved2}
        status={
          speed === LOW_DEFAULTS.speed
            ? `At ${fmt(LOW_DEFAULTS.speed)} m/s the lag is ${fmt(lagDefault, 1)} hours. What speed stretches it to ${LAG_TARGET_H}?`
            : `At ${fmt(speed, 1)} m/s, the cold front reaches Fenwick Bay ${fmt(lag, 1)} hours after Marlow.`
        }
        success={`Solved. The lag is inversely proportional to the speed: ${fmt(lagDefault, 1)} h × ${fmt(LOW_DEFAULTS.speed)}/${fmt(speed, 1)} = ${fmt(lag, 1)} h. At ${fmt(speed, 1)} m/s the system covers ${fmt(speed * 3.6 * LAG_TARGET_H)} km in ${LAG_TARGET_H} hours, a little less than the ${fmt(STATIONS.fenwick.x - STATIONS.marlow.x)} km that Fenwick Bay lies east of Marlow: the cold front leans back toward the south-west, so it reaches the city, which lies slightly farther north, a little sooner. A forecaster who sees the front pass Marlow knows, to within an hour or so, when it will reach Fenwick Bay.`}
      />

      <P>
        <FigRef to="Weather Front Lab">The first demonstration</FigRef> lifted stable air: it rose only because the front forced it to, and the rain came out at
        a few millimeters an hour. When the air being lifted is unstable, as on the summer afternoons of <a href={lessonHref('weather/1.4')}>Lesson 1.4</a>, a front
        can be the push that sets it rising on its own, and a line of thunderstorms can erupt along it. The next lesson asks what it takes to build a storm, and why
        some storms last minutes and others hours.
      </P>
    </LessonPage>
  );
}
