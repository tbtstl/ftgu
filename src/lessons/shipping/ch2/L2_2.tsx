import { useEffect, useMemo } from 'react';
import {
  Caption,
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
  TEXT,
  fmt,
  lessonHref,
  tint,
  usd,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { KESTREL } from '../../../model/shipping/vessels';
import { maxCargo } from '../../../engines/shipping/hydrostatics';
import { CARGOES } from '../../../engines/shipping/stability';
import {
  ALLOWABLE_MOMENT,
  holdPlan,
  holdSpan,
  hullStrength,
  laytime,
  portHours,
  pourOrder,
  simulateLoading,
  type LoadingResult,
} from '../../../engines/shipping/loading';
import { ShipSide } from '../shared/ShipSide';
import { CARGO_COLOR } from '../shared/tones';

const V = KESTREL;
const PLAN = holdPlan(V);
const HOLDS = PLAN.holds;
/** The coal cargo: Kestrel's full intake, to the nearest hundred tonnes. */
export const CARGO = 79_500;
export const ARRIVAL_BALLAST = V.ballast;
/** Hours to move a shiploader from one hold to the next. */
export const SHIFT_HOURS = 0.5;
/** The challenge's deadline, hours. */
export const DEADLINE_HOURS = 10;
/** Berthing, hatches, the two draft surveys and the paperwork, hours. */
export const FORMALITIES_HOURS = 8;
/** Illustrative charter terms. */
export const DEMURRAGE = 15_000;
export const DESPATCH = DEMURRAGE / 2;

const COAL = CARGO_COLOR.coal;
const HOLD_VOLUME = (V.holdVolume ?? 0) / HOLDS;

/** One loading run of the full coal cargo. */
export function loadingRun(passes: number, loaders: number, loaderRate: number, pumpRate: number): LoadingResult {
  return simulateLoading({ cargo: CARGO, passes, loaders, loaderRate, pumpRate, ballast: ARRIVAL_BALLAST, shiftHours: SHIFT_HOURS }, V);
}

/**
 * The challenge: every tonne in (and the ballast out) in under 10 hours, with the bending moment
 * never above the allowable. The solutions on the sliders' grid all use two passes and two loaders
 * pouring at 6,000 t/h or more, with pumps of at least 4,000 t/h.
 */
export function fastSafeSolved(passes: number, loaders: number, loaderRate: number, pumpRate: number): boolean {
  const r = loadingRun(passes, loaders, loaderRate, pumpRate);
  return r.hours < DEADLINE_HOURS - 1e-9 && r.peakMoment <= ALLOWABLE_MOMENT + 1e-6;
}

/** Hold number as painted on the ship: No. 1 is the forwardmost. */
const holdNo = (i: number) => HOLDS - i;

// Numbers the prose quotes.
const R_DEFAULT = loadingRun(2, 1, 4000, 3000);
const R_ONE_PASS = loadingRun(1, 1, 4000, 3000);
const R_TWO_LOADERS = loadingRun(2, 2, 4000, 3000);
const R_SLOW_PUMPS = loadingRun(2, 2, 4000, 1500);
const R_FAST_PUMPS = loadingRun(2, 2, 4000, 4500);
const ARRIVAL = hullStrength(V, PLAN, Array(HOLDS).fill(0), ARRIVAL_BALLAST);
const KEPT_BALLAST_CARGO = maxCargo(V, V.consumables, ARRIVAL_BALLAST);
const pctOf = (m: number) => `${fmt((100 * m) / ALLOWABLE_MOMENT)}%`;
const h1 = (x: number) => `${fmt(x, 1)} h`;
const t = (x: number) => `${fmt(x)} t`;
const ORDER = pourOrder(HOLDS).map(holdNo);

// Figure geometry.
const SHIP_X = 32;
const SHIP_W = 576;
const EXAG = 1.7;
const SX = SHIP_W / V.loa;
const SZ = SX * EXAG;
const KEEL_Y = 196;
/** Hull position (m from the aft perpendicular) to the drawing. */
const hx = (x: number) => SHIP_X + ((V.loa - V.lbp) / 2 + x) * SX;
const zy = (z: number) => KEEL_Y - z * SZ;
const CH_ZERO = 328;
const CH_HALF = 82;
const CH_MAX = 600_000;
const my = (m: number) => CH_ZERO - (Math.max(-CH_MAX, Math.min(CH_MAX, m)) / CH_MAX) * CH_HALF;
const TL_X0 = 96;
const TL_X1 = 608;
const TL_Y = 444;
const TL_ROW = 15;

type SegKind = 'pour' | 'shift' | 'wait';
interface Seg {
  kind: SegKind;
  from: number;
  to: number;
  hold: number;
}

/** What each loader was doing over the run, as merged segments. */
function loaderSegments(r: LoadingResult, loaders: number): Seg[][] {
  return Array.from({ length: loaders }, (_, j) => {
    let lastPour = 0;
    r.frames.forEach((f, k) => {
      if ((f.at[j] ?? -1) >= 0) lastPour = k;
    });
    const segs: Seg[] = [];
    for (let k = 1; k <= lastPour; k++) {
      const f = r.frames[k];
      const at = f.at[j] ?? -1;
      const kind: SegKind = at >= 0 ? 'pour' : f.waiting ? 'wait' : 'shift';
      const prev = segs[segs.length - 1];
      if (prev && prev.kind === kind && prev.hold === at) prev.to = f.t;
      else segs.push({ kind, from: r.frames[k - 1].t, to: f.t, hold: at });
    }
    return segs;
  });
}

const SEG_COLOR: Record<SegKind, string> = { pour: COAL, shift: '#cfcbc3', wait: GRAPHIC.red };

export default function Lesson() {
  // ---- Demonstration 1: the loading plan.
  const lp = useScenario('loading', { passes: 2, loaders: '1' as '1' | '2', rate: 4000, pump: 3000, time: 1 });
  const { passes, rate, pump, time } = lp.state;
  const loaders = Number(lp.state.loaders);
  const run = useMemo(() => loadingRun(passes, loaders, rate, pump), [passes, loaders, rate, pump]);
  const segs = useMemo(() => loaderSegments(run, loaders), [run, loaders]);
  const frameIdx = Math.round(time * (run.frames.length - 1));
  const frame = run.frames[frameIdx];
  const st = hullStrength(V, PLAN, frame.cargoPerHold, frame.ballast);
  const aboard = frame.cargoPerHold.reduce((a, b) => a + b, 0);
  const meanDraft = (st.draftAft + st.draftFwd) / 2;
  const over = run.peakMoment > ALLOWABLE_MOMENT + 1e-6;
  const solved = fastSafeSolved(passes, loaders, rate, pump);
  const peakT = run.frames[run.peakFrame].t;

  const play = usePlay(false);
  useAnimationFrame((dt) => lp.set((s) => ({ time: Math.min(1, s.time + dt / 10) })), play.playing);
  useEffect(() => {
    if (play.playing && time >= 1) play.setPlaying(false);
  }, [play, time]);
  const replay = {
    playing: play.playing,
    toggle: () => {
      if (!play.playing && time >= 1) lp.set({ time: 0 });
      play.toggle();
    },
  };

  const tx = (h: number) => TL_X0 + (h / Math.max(run.hours, 1e-9)) * (TL_X1 - TL_X0);
  const pouring = frame.at.map((h, j) => ({ h, j })).filter((p) => p.h >= 0);
  const momentPath = st.xs.map((x, i) => `${i ? 'L' : 'M'}${hx(x).toFixed(1)} ${my(st.moment[i]).toFixed(1)}`).join(' ');
  const momentArea = `${momentPath} L${hx(st.xs[st.xs.length - 1]).toFixed(1)} ${CH_ZERO} L${hx(0).toFixed(1)} ${CH_ZERO} Z`;
  const nowPct = (100 * st.maxMoment) / ALLOWABLE_MOMENT;
  const nowOver = st.maxMoment > ALLOWABLE_MOMENT + 1e-6;
  const bend = st.signedMax >= 0 ? 'hogging' : 'sagging';

  const doing =
    pouring.length > 0
      ? pouring.map((p) => `loader ${p.j + 1} is pouring into No. ${holdNo(p.h)} hold`).join(' and ')
      : frame.waiting
        ? 'the loaders are waiting for the pumps'
        : frameIdx === 0
          ? 'loading is about to start'
          : aboard >= CARGO - 0.5
            ? frame.ballast > 0.5
              ? 'the cargo is in and the last ballast is going out'
              : 'loading is finished'
            : 'the loaders are moving between holds';

  // ---- Demonstration 2: laytime.
  const lt = useScenario('laytime', { waitDays: 0, weatherHours: 0, ratePerDay: 25_000, notice: '6' as '6' | '12', weather: 'excluded' as 'excluded' | 'counts' });
  const call = { waitingHours: lt.state.waitDays * 24, formalitiesHours: FORMALITIES_HOURS, loadingHours: run.hours, rainHours: lt.state.weatherHours };
  const terms = { ratePerDay: lt.state.ratePerDay, noticeHours: Number(lt.state.notice), excludeWeather: lt.state.weather === 'excluded', demurrage: DEMURRAGE, despatch: DESPATCH };
  const lay = laytime(CARGO, call, terms);
  const callDays = portHours(call) / 24;
  const dayMax = Math.max(4, Math.ceil(Math.max(callDays, terms.noticeHours / 24 + lay.allowedDays, terms.noticeHours / 24 + lay.usedDays) + 0.25));
  const dx = (d: number) => 132 + (d / dayMax) * (608 - 132);
  const callSegs = [
    { label: 'waiting', hours: call.waitingHours, color: '#d8d4cc' },
    { label: 'berthing, surveys', hours: FORMALITIES_HOURS / 2, color: '#ece9e2' },
    { label: 'loading', hours: call.loadingHours, color: COAL },
    { label: 'weather', hours: call.rainHours, color: tint(GRAPHIC.blue, 0.6) },
    { label: 'surveys, papers', hours: FORMALITIES_HOURS / 2, color: '#ece9e2' },
  ];
  let acc = 0;
  const callBlocks = callSegs.map((s) => {
    const b = { ...s, from: acc / 24, to: (acc + s.hours) / 24 };
    acc += s.hours;
    return b;
  });
  const startDay = terms.noticeHours / 24;
  const demurrage = lay.balance > 0;

  const LT_DEFAULT = (wait: number, weatherHours = 0, excludeWeather = true) =>
    laytime(CARGO, { waitingHours: wait * 24, formalitiesHours: FORMALITIES_HOURS, loadingHours: R_DEFAULT.hours, rainHours: weatherHours }, { ...terms, ratePerDay: 25_000, noticeHours: 6, excludeWeather });

  return (
    <LessonPage id="shipping/2.2">
      <P>
        <a href={lessonHref('shipping/2.1')}>The previous lesson</a> sorted ships by what they carry and where they fit. Whatever her size, a ship earns money only
        while she carries cargo from one place to another. Every hour she lies alongside a berth, her crew, her insurance and the capital tied up in her hull are
        paid for without a mile covered, and every voyage has at least two such stops: one to load and one to discharge. So this lesson asks what decides how long
        loading takes, and what stops it from going faster.
      </P>
      <P>
        Kestrel has come to a coal terminal to load {t(CARGO)}, her full intake. She arrives in ballast, with {t(ARRIVAL_BALLAST)} of sea water in her tanks to
        keep her propeller deep and her hull steady, as we saw in <a href={lessonHref('shipping/1.4')}>Lesson 1.4</a>. The terminal’s <b>shiploaders</b> — long
        booms that swing out over a hatch and pour coal off a conveyor — can move thousands of tonnes an hour. Two things hold them back: the ship’s hull, and her
        ballast pumps.
      </P>
      <P>
        Seen from the side, a ship is a long, hollow beam: the <b>hull girder</b>. Her weight and her buoyancy balance overall — that is why she floats — but they
        don’t balance meter by meter. Her engine room is heavy and her bow is fine. A hold full of coal weighs far more than the water its slice of hull displaces;
        an empty one, far less. Wherever weight and buoyancy don’t match, the beam is pushed up or down, and it bends. If the middle carries more weight than
        buoyancy, the ship <K tone="violet">sags</K>: the middle droops, squeezing her deck and stretching her bottom. If the ends are heavier, she{' '}
        <K tone="violet">hogs</K>, arching upward and stretching her deck. The bending is measured as a <K tone="violet">bending moment</K>, in tonne-meters, and every
        ship has an allowable maximum. Kestrel’s, in our model, is {fmt(ALLOWABLE_MOMENT)} tonne-meters in port.
      </P>
      <P>
        In the next demonstration Kestrel loads from start to finish. Her holds are numbered from the bow, as on a real ship. The chart under her is the bending
        moment along her length at the moment shown, with the allowable limit dashed, and the strip at the bottom records what each shiploader was doing. Choose
        how many passes the cargo goes in, how many loaders the terminal provides, how fast they pour and how fast her pumps discharge ballast — then press play, or
        drag the replay slider:
      </P>

      <Figure name="Cargo Loading Planner" scenario={lp} play={replay}>
        <svg
          className="diagram"
          viewBox="0 0 640 502"
          role="img"
          aria-label={`Kestrel loading ${t(CARGO)} of coal in ${passes} ${passes === 1 ? 'pass' : 'passes'} with ${loaders} ${loaders === 1 ? 'shiploader' : 'shiploaders'} at ${fmt(rate)} t/h and ballast pumps at ${fmt(pump)} t/h. Loading takes ${h1(run.hours)}; the bending moment peaks at ${pctOf(run.peakMoment)} of the allowable. At ${h1(frame.t)}, ${t(aboard)} is aboard and ${t(frame.ballast)} of ballast is left; the moment is ${fmt(nowPct)}% of the allowable, ${bend}.`}
        >
          <ShipSide
            v={V}
            draft={meanDraft}
            trim={st.trim}
            x={SHIP_X}
            width={SHIP_W}
            keelY={KEEL_Y}
            exaggerate={EXAG}
            holds={frame.cargoPerHold.map((c) => (c * CARGOES.coal.stowage) / HOLD_VOLUME)}
            cargoColor={COAL}
          />
          {Array.from({ length: HOLDS }, (_, i) => {
            const [a, b] = holdSpan(PLAN, i);
            return (
              <text key={i} x={hx((a + b) / 2)} y={zy(V.depth + 1.8) - 5} textAnchor="middle" className="ax">
                {holdNo(i)}
              </text>
            );
          })}
          {/* the shiploaders */}
          {pouring.map((p) => {
            const [a, b] = holdSpan(PLAN, p.h);
            const cx = hx((a + b) / 2);
            return (
              <g key={p.j}>
                <rect x={cx - 14} y={44} width={28} height={10} rx={2} fill="#8a8a8a" />
                <line x1={cx} x2={cx} y1={54} y2={zy(V.depth + 1.8) - 16} stroke={COAL} strokeWidth={5} />
                <text x={cx} y={39} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: '#333' }}>
                  L{p.j + 1}
                </text>
              </g>
            );
          })}
          {/* cargo and ballast gauges */}
          {[
            { label: 'Cargo aboard', value: aboard, max: CARGO, color: COAL, text: TEXT.ink, y: 12 },
            { label: 'Ballast left', value: frame.ballast, max: ARRIVAL_BALLAST, color: GRAPHIC.blue, text: TEXT.blue, y: 0 },
          ].map((g, i) => (
            <g key={g.label} transform={`translate(${i === 0 ? 300 : 460}, 6)`}>
              <text className="ax" x={0} y={10}>
                {g.label}
              </text>
              <rect x={0} y={15} width={130} height={7} fill="#ecebe7" />
              <rect x={0} y={15} width={(130 * g.value) / g.max} height={7} fill={g.color} />
              <text x={130} y={10} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: g.text }}>
                {t(g.value)}
              </text>
            </g>
          ))}
          {frame.waiting && (
            <text x={300} y={46} style={{ fontSize: 12, fontWeight: 600, fill: TEXT.red }}>
              Waiting for the ballast pumps
            </text>
          )}
          {/* drafts */}
          <text x={SHIP_X + 4} y={zy(st.draftAft) + 15} style={{ fontSize: 12, fontWeight: 600, fill: TEXT.blue }}>
            aft {fmt(st.draftAft, 2)} m
          </text>
          <text x={SHIP_X + SHIP_W - 4} y={zy(st.draftFwd) + 15} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: TEXT.blue }}>
            forward {fmt(st.draftFwd, 2)} m
          </text>
          {/* the bending moment */}
          <text className="ax" x={SHIP_X} y={CH_ZERO - CH_HALF - 6}>
            Bending moment along the hull, t·m
          </text>
          <line className="base" x1={hx(0)} x2={hx(V.lbp)} y1={CH_ZERO} y2={CH_ZERO} />
          {[1, -1].map((sgn) => (
            <g key={sgn}>
              <line x1={hx(0)} x2={hx(V.lbp)} y1={my(sgn * ALLOWABLE_MOMENT)} y2={my(sgn * ALLOWABLE_MOMENT)} stroke={GRAPHIC.red} strokeWidth={1.2} strokeDasharray="5 4" />
              <text x={hx(V.lbp)} y={my(sgn * ALLOWABLE_MOMENT) + (sgn > 0 ? -4 : 13)} textAnchor="end" className="ax">
                allowable {sgn > 0 ? 'hogging' : 'sagging'}
              </text>
            </g>
          ))}
          <text className="ax" x={SHIP_X} y={CH_ZERO - 6}>
            hog ↑
          </text>
          <text className="ax" x={SHIP_X} y={CH_ZERO + 15}>
            sag ↓
          </text>
          <path d={momentArea} fill={nowOver ? GRAPHIC.red : GRAPHIC.violet} opacity={0.14} />
          <path d={momentPath} fill="none" stroke={nowOver ? GRAPHIC.red : GRAPHIC.violet} strokeWidth={2.5} strokeLinejoin="round" />
          <circle cx={hx(st.maxAt)} cy={my(st.signedMax)} r={4.5} fill={nowOver ? TEXT.red : TEXT.violet} stroke="#fcfcfb" strokeWidth={1.5} />
          <text
            x={hx(st.maxAt) + 8}
            y={my(st.signedMax) + (st.signedMax >= 0 ? -8 : 16)}
            style={{ fontSize: 12, fontWeight: 600, fill: nowOver ? TEXT.red : TEXT.violet }}
          >
            {fmt(nowPct)}% of allowable
          </text>
          {/* the timeline */}
          {segs.map((row, j) => (
            <g key={j}>
              <text className="ax" x={SHIP_X} y={TL_Y + j * (TL_ROW + 5) + 11}>
                Loader {j + 1}
              </text>
              <rect x={TL_X0} y={TL_Y + j * (TL_ROW + 5)} width={TL_X1 - TL_X0} height={TL_ROW} fill="#f4f3f0" />
              {row.map((s, k) => (
                <rect key={k} x={tx(s.from)} y={TL_Y + j * (TL_ROW + 5)} width={Math.max(0.6, tx(s.to) - tx(s.from))} height={TL_ROW} fill={SEG_COLOR[s.kind]} />
              ))}
            </g>
          ))}
          {loaders === 1 && (
            <text className="ax" x={TL_X0} y={TL_Y + TL_ROW + 16}>
              one shiploader at this berth
            </text>
          )}
          <line x1={tx(peakT)} x2={tx(peakT)} y1={TL_Y - 4} y2={TL_Y + 2 * (TL_ROW + 5) - 2} stroke={over ? TEXT.red : TEXT.violet} strokeWidth={1.5} />
          <text x={tx(peakT)} y={TL_Y - 7} textAnchor={tx(peakT) > 540 ? 'end' : 'middle'} style={{ fontSize: 11, fontWeight: 600, fill: over ? TEXT.red : TEXT.violet }}>
            peak {pctOf(run.peakMoment)}
          </text>
          <line className="cur" x1={tx(frame.t)} x2={tx(frame.t)} y1={TL_Y - 2} y2={TL_Y + 2 * (TL_ROW + 5)} />
          <text className="ax" x={TL_X0} y={498}>
            0 h
          </text>
          <text className="ax ax-e" x={TL_X1} y={498}>
            {h1(run.hours)}
          </text>
        </svg>
        <Legend
          items={[
            { label: 'Pouring', color: COAL },
            { label: 'Moving between holds', color: SEG_COLOR.shift },
            { label: 'Waiting for the pumps', color: SEG_COLOR.wait },
            { label: 'Bending moment', color: GRAPHIC.violet, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'loading time, cargo in and ballast out', value: h1(run.hours), tone: 'teal' },
            { label: 'peak bending moment', value: `${pctOf(run.peakMoment)} of allowable`, tone: over ? 'red' : 'violet' },
            { label: 'waiting for the pumps', value: h1(run.waitHours), tone: run.waitHours > 0.01 ? 'red' : undefined },
            { label: 'trim at the end', value: `${fmt(Math.abs(run.final.trim), 2)} m by the ${run.final.trim >= 0 ? 'stern' : 'head'}`, tone: 'blue' },
          ]}
        />
        <Segmented
          label="Shiploaders"
          value={lp.state.loaders}
          onChange={(v) => lp.set({ loaders: v, time: 1 })}
          options={[
            { value: '1', label: 'One shiploader' },
            { value: '2', label: 'Two shiploaders' },
          ]}
        />
        <Slider label="Passes over the holds" value={passes} min={1} max={4} step={1} onChange={(v) => lp.set({ passes: v, time: 1 })} display={`${passes} ${passes === 1 ? 'pour' : 'pours'} per hold`} />
        <Slider label="Rate of each loader" tone="orange" value={rate} min={2000} max={8000} step={500} onChange={(v) => lp.set({ rate: v, time: 1 })} display={`${fmt(rate)} t/h`} />
        <Slider label="Ballast pumps" tone="blue" value={pump} min={1500} max={4500} step={500} onChange={(v) => lp.set({ pump: v, time: 1 })} display={`${fmt(pump)} t/h`} />
        <Slider label="Replay" tone="teal" value={time} min={0} max={1} step={0.002} onChange={(v) => lp.set({ time: v })} display={`${h1(frame.t)} of ${h1(run.hours)}`} />
        <Caption>
          At {h1(frame.t)}, {doing}. {t(aboard)} of coal is aboard and {t(frame.ballast)} of ballast is left; she floats at {fmt(meanDraft, 2)} m,{' '}
          {Math.abs(st.trim) < 0.05 ? 'on an even keel' : `${fmt(Math.abs(st.trim), 2)} m by the ${st.trim > 0 ? 'stern' : 'head'}`}, and her hull is{' '}
          {bend} at {fmt(nowPct)}% of the allowable.
        </Caption>
      </Figure>

      <P>
        The starting plan pours the cargo in two passes, half of each hold’s share at a time, with one loader working at 4,000 tonnes an hour and the pumps
        discharging 3,000. It works the holds from midships outward, alternating forward and aft — No. {ORDER.join(', ')} — and back again on the second pass.
        Loading takes {h1(R_DEFAULT.hours)}, {h1(R_DEFAULT.shiftHours)} of it spent moving the loader from hatch to hatch, and the bending moment never passes{' '}
        {pctOf(R_DEFAULT.peakMoment)} of the allowable.
      </P>
      <P>
        Now drop to a single pass, so that each hold is filled to the top before the next is started. Loading is quicker, {h1(R_ONE_PASS.hours)}, because the
        loader moves only six times. But a full hold amidships with empty holds around it is a heavy weight in the middle of the beam, and as the sequence works
        outward the sag grows until it reaches {pctOf(R_ONE_PASS.peakMoment)} of the allowable. A hull bent that far risks buckling and cracking. That is why bulk
        cargoes go in passes, a share into each hold at a time, so the weight builds evenly along the ship.
      </P>

      <H2>Racing the pumps</H2>
      <P>
        The second limit is ballast. If Kestrel kept all {t(ARRIVAL_BALLAST)} of it, her summer mark would reach the water with only {t(KEPT_BALLAST_CARGO)} of coal
        aboard (<a href={lessonHref('shipping/1.1')}>Lesson 1.1</a>). So the pumps must discharge the ballast while the coal comes in, and they set a ceiling on how
        fast the loading can go: the ship can’t take cargo faster than she sheds ballast for long, or she would sink past her marks. Give her two loaders and the
        same plan takes {h1(R_TWO_LOADERS.hours)}. Now slow the pumps to 1,500 tonnes an hour. The loaders stand idle for {h1(R_SLOW_PUMPS.waitHours)} while she
        rises, and loading stretches to {h1(R_SLOW_PUMPS.hours)}.
      </P>
      <P>
        Ballast also bends the hull. It lies in tanks under the holds, so every tonne still aboard adds to the weight in the middle of the ship. With two loaders
        at 4,000 tonnes an hour, the worst moment comes early, {h1(R_TWO_LOADERS.frames[R_TWO_LOADERS.peakFrame].t)} in, when the middle holds have their first
        pours and most of the ballast is still in her tanks: {pctOf(R_TWO_LOADERS.peakMoment)} of the allowable with the pumps at 3,000 tonnes an hour, against{' '}
        {pctOf(R_FAST_PUMPS.peakMoment)} with the pumps at 4,500. Faster pumps don’t only save time; they lighten the middle of the ship sooner. Faster loaders do
        the opposite: they put more coal into the middle while the ballast is still there.
      </P>
      <P>
        Watch her drafts, too. She arrives {fmt(ARRIVAL.trim, 2)} meters down by the stern, her propeller deep, and must finish nearly level — {fmt(R_DEFAULT.final.trim, 2)}{' '}
        meters by the stern once the coal is spread evenly — so that she sails at her marks. Real chief officers tune the last pours of each hold to bring her to the
        trim they want. None of this is improvised at the berth. IMO’s Code of Practice for the Safe Loading and Unloading of Bulk Carriers, the BLU Code, requires
        the ship and the terminal to agree a loading plan, ballasting included, before the first tonne goes in, and the plan is checked against the ship’s own
        limits for bending and shear. The rates and the allowable moment in this demonstration are our model’s, and real terminals vary widely, but the race
        between the loaders, the pumps and the hull is the same everywhere.
      </P>

      <Challenge
        id="a"
        figure="Cargo Loading Planner"
        question={`The charterer wants Kestrel loaded and sailing quickly. Load all ${t(CARGO)} in under ${DEADLINE_HOURS} hours, with the bending moment never passing the allowable.`}
        solved={solved}
        status={
          over
            ? `This plan takes ${h1(run.hours)}, but the bending moment reaches ${pctOf(run.peakMoment)} of the allowable at ${h1(peakT)}.`
            : `This plan stays within the allowable (peak ${pctOf(run.peakMoment)}) but takes ${h1(run.hours)}.`
        }
        success={`Solved: ${h1(run.hours)} with a peak of ${pctOf(run.peakMoment)}. Every plan that does it uses two passes and two loaders at 6,000 t/h or more, with pumps of at least 4,000 t/h. A single pass is faster still but bends the hull past twice its limit; slower pumps leave ballast in the middle while the coal piles in. The quickest safe plan, with both loaders at 8,000 t/h and the pumps at 4,500, takes ${h1(loadingRun(2, 2, 8000, 4500).hours)} — and sits right at the limit.`}
      />

      <H2>The commercial clock</H2>
      <P>
        Who pays for the time a ship spends in port? When a cargo owner hires a ship to carry a single cargo, the contract — the <b>charter party</b> — gives the
        charterer an agreed amount of time to load and discharge, called <K tone="teal">laytime</K>. Here it is set by an agreed loading rate: at 25,000 tonnes a day,{' '}
        {t(CARGO)} earns {fmt(CARGO / 25_000, 2)} days. The clock starts when the master tenders a <b>notice of readiness</b> on arrival, plus a few hours’ grace. If
        loading finishes inside laytime, the owner pays the charterer <K tone="green">despatch</K> for each day saved, commonly half the demurrage rate. If it runs
        over, the charterer pays the owner <K tone="green">demurrage</K> for every extra day: compensation for a ship kept from her next voyage.
      </P>
      <P>
        In the next demonstration, the loading takes whatever time the plan in <FigRef to="Cargo Loading Planner">the first demonstration</FigRef> needs. Add days
        waiting for a berth and hours lost to weather, change the agreed rate, the notice time and whether weather stoppages count against laytime. The upper bar
        is the call as it happened; the lower one is laytime used against laytime allowed. Demurrage is an illustrative {usd(DEMURRAGE)} a day:
      </P>

      <Figure name="Cargo Loading Planner · laytime" scenario={lt}>
        <svg
          className="diagram"
          viewBox="0 0 640 150"
          role="img"
          aria-label={`The port call lasts ${fmt(callDays, 2)} days: ${fmt(lt.state.waitDays, 2)} days waiting, ${h1(run.hours)} loading and ${lt.state.weatherHours} hours of weather. Laytime allowed is ${fmt(lay.allowedDays, 2)} days and ${fmt(lay.usedDays, 2)} days count; ${demurrage ? `the charterer owes ${usd(lay.balance)} in demurrage` : `the owner owes ${usd(-lay.balance)} in despatch`}.`}
        >
          <text className="ax" x={16} y={36}>
            The call
          </text>
          {callBlocks.map((b) =>
            b.to > b.from ? <rect key={b.label} x={dx(b.from)} y={22} width={Math.max(0.6, dx(b.to) - dx(b.from))} height={20} fill={b.color} stroke="#fcfcfb" strokeWidth={0.5} /> : null,
          )}
          <line x1={dx(0)} x2={dx(0)} y1={14} y2={50} stroke="#555" strokeWidth={1.2} />
          <text className="ax" x={dx(0)} y={11}>
            notice of readiness
          </text>
          <text className="ax" x={16} y={86}>
            Laytime
          </text>
          <rect x={dx(startDay)} y={72} width={dx(startDay + lay.allowedDays) - dx(startDay)} height={20} fill="none" stroke="#555" strokeWidth={1.2} strokeDasharray="4 3" />
          <rect x={dx(startDay)} y={76} width={Math.max(0, dx(startDay + Math.min(lay.usedDays, lay.allowedDays)) - dx(startDay))} height={12} fill={tint(GRAPHIC.teal, 0.7)} />
          {demurrage ? (
            <rect x={dx(startDay + lay.allowedDays)} y={76} width={dx(startDay + lay.usedDays) - dx(startDay + lay.allowedDays)} height={12} fill={GRAPHIC.red} opacity={0.75} />
          ) : null}
          <text className="ax" x={dx(startDay + lay.allowedDays)} y={108} textAnchor="middle">
            allowed {fmt(lay.allowedDays, 2)} d
          </text>
          <text
            x={dx(startDay + lay.usedDays) + (demurrage ? 6 : -6)}
            y={66}
            textAnchor={demurrage ? 'start' : 'end'}
            style={{ fontSize: 12, fontWeight: 600, fill: demurrage ? TEXT.red : TEXT.teal }}
          >
            used {fmt(lay.usedDays, 2)} d
          </text>
          {Array.from({ length: dayMax + 1 }, (_, d) => (
            <g key={d}>
              <line x1={dx(d)} x2={dx(d)} y1={118} y2={122} stroke="#9a9a9a" />
              <text className="ax ax-m" x={dx(d)} y={136}>
                {d}
              </text>
            </g>
          ))}
          <text className="ax ax-e" x={608} y={148}>
            days since arrival
          </text>
        </svg>
        <Legend
          items={[
            { label: 'Waiting for a berth', color: '#d8d4cc' },
            { label: 'Loading', color: COAL },
            { label: 'Weather stoppages', color: tint(GRAPHIC.blue, 0.6) },
            { label: 'Laytime used', color: tint(GRAPHIC.teal, 0.7) },
            { label: 'On demurrage', color: GRAPHIC.red },
          ]}
        />
        <Readouts
          items={[
            { label: 'laytime allowed', value: `${fmt(lay.allowedDays, 2)} days`, tone: 'teal' },
            { label: 'laytime used', value: `${fmt(lay.usedDays, 2)} days`, tone: 'teal' },
            {
              label: demurrage ? 'demurrage, charterer pays owner' : 'despatch, owner pays charterer',
              value: usd(Math.abs(lay.balance)),
              tone: 'green',
            },
          ]}
        />
        <Segmented
          label="Notice time"
          value={lt.state.notice}
          onChange={(v) => lt.set({ notice: v })}
          options={[
            { value: '6', label: '6 hours’ notice' },
            { value: '12', label: '12 hours’ notice' },
          ]}
        />
        <Segmented
          label="Weather terms"
          value={lt.state.weather}
          onChange={(v) => lt.set({ weather: v })}
          options={[
            { value: 'excluded', label: 'Weather stoppages excluded' },
            { value: 'counts', label: 'Weather counts' },
          ]}
        />
        <Slider label="Waiting for a berth" tone="teal" value={lt.state.waitDays} min={0} max={10} step={0.25} onChange={(v) => lt.set({ waitDays: v })} display={`${fmt(lt.state.waitDays, 2)} days`} />
        <Slider label="Weather stoppages" tone="teal" value={lt.state.weatherHours} min={0} max={48} step={2} onChange={(v) => lt.set({ weatherHours: v })} display={`${lt.state.weatherHours} h`} />
        <Slider label="Agreed loading rate" tone="orange" value={lt.state.ratePerDay} min={15_000} max={40_000} step={1000} onChange={(v) => lt.set({ ratePerDay: v })} display={`${fmt(lt.state.ratePerDay)} t/day`} />
        <Caption>
          Loading takes {h1(run.hours)}, from the plan in the first demonstration; berthing, hatches, the two draft surveys and the paperwork add{' '}
          {FORMALITIES_HOURS} hours. Waiting counts as laytime, as it does under a “whether in berth or not” clause.
        </Caption>
      </Figure>

      <P>
        With the starting loading plan and a berth free on arrival, the ship is done in {fmt(LT_DEFAULT(0).usedDays, 2)} counted days of her{' '}
        {fmt(LT_DEFAULT(0).allowedDays, 2)}, and her owner pays {usd(-LT_DEFAULT(0).balance)} in despatch. Now make her wait for a berth. Two days at anchor and the
        call runs just past laytime: {usd(LT_DEFAULT(2).balance)} of demurrage. Three days and it is {usd(LT_DEFAULT(3).balance)}, a day’s demurrage for every
        extra day. Add a day of weather on top of that: with stoppages excluded, as on “weather working days” terms, the bill is unchanged; if weather counts, it
        rises to {usd(LT_DEFAULT(3, 24, false).balance)}.
      </P>
      <P>
        These clauses decide who carries the risk of a slow port. Under the terms here, the charterer pays for the berth queue, and the owner is compensated for a
        ship kept from her next voyage — though at a fixed rate, which may be more or less than she could have earned elsewhere. Other contracts start the clock
        only once the ship is in berth, and leave the waiting to the owner. Either way, someone pays, and when ports grow crowded, demurrage bills grow with them.
        Why ports become congested, and what queues of waiting ships do to the supply of ships for everyone else, is the subject of{' '}
        <a href={lessonHref('shipping/3.2')}>Lesson 3.2</a>.
      </P>
      <P>
        Port time is one side of a voyage’s clock. The other, usually much longer, is time at sea, and there the trade-off is between days and fuel: sail faster
        and the cargo arrives sooner but burns more, as <a href={lessonHref('shipping/1.3')}>Lesson 1.3</a> showed. In{' '}
        <a href={lessonHref('shipping/2.3')}>the next lesson</a> we’ll put a price on both, and find the speed that earns Kestrel the most per day.
      </P>
    </LessonPage>
  );
}
