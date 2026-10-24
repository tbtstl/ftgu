import {
  Caption,
  Challenge,
  Eq,
  Figure,
  Frac,
  GridY,
  H2,
  K,
  LessonPage,
  Op,
  P,
  Segmented,
  Slider,
  Sup,
  fmt,
  lessonHref,
  mix,
  mw,
  scale,
  tint,
  usePlay,
  useScenario,
} from '../../framework';
import { TYPICAL_OHM_PER_KM, lineLoss } from '../../engines/physics/losses';

const KV = [69, 138, 230, 345, 500, 765];
const SAME_OHM_PER_KM = 0.03;
/** Above this share lost, the voltage-class chart marks a line impractical instead of drawing its bar. */
const IMPRACTICAL_SHARE = 0.2;
const RED = '#e75b55';

// Line diagram geometry: the line runs from the plant's gantry to the city's.
const LX0 = 98;
const LX1 = 548;
const SPANS = [LX0, 188, 278, 368, 458, LX1];
const CHART_TOP = 192;
const CHART_H = 90;
/** The thermal-rating gauge sits above the line; the line diagram moves down to make room. */
const GAUGE_SHIFT = 16;

export const LINE_DEFAULTS = { sendMW: 100, kvIdx: 0, lengthKm: 100, ohmPerKm: 0.15 };
const CHALLENGE_KV = 138;

/**
 * An illustrative thermal rating, in amperes, for one conductor with this resistance. A thicker
 * conductor has less resistance and more surface to shed heat, so it can carry more current; for
 * single aluminum conductors the rating grows roughly as resistance^−0.6. This gives 600 A at
 * 0.15 Ω/km and about 880 A at 0.08 Ω/km, close to typical ratings for conductors of those sizes.
 */
export function thermalRatingAmps(ohmPerKm: number) {
  return 600 * (0.15 / ohmPerKm) ** 0.6;
}

/** What the starting line loses: 100 MW at 69 kV over 100 km of 0.15 Ω/km conductor. */
export function startingLossMW() {
  const d = LINE_DEFAULTS;
  return lineLoss({ sendMW: d.sendMW, kV: KV[d.kvIdx], lengthKm: d.lengthKm, ohmPerKm: d.ohmPerKm }).lossMW;
}

/**
 * The challenge: at twice the starting voltage, with the starting power and conductor, the length
 * of line that loses the same as the starting line. The loss goes as length ÷ voltage², so 400 km.
 */
export function reachSolved(st: typeof LINE_DEFAULTS) {
  const d = LINE_DEFAULTS;
  if (KV[st.kvIdx] !== CHALLENGE_KV || st.sendMW !== d.sendMW || Math.abs(st.ohmPerKm - d.ohmPerKm) > 1e-9) return false;
  const loss = lineLoss({ sendMW: st.sendMW, kV: CHALLENGE_KV, lengthKm: st.lengthKm, ohmPerKm: st.ohmPerKm }).lossMW;
  return Math.abs(loss - startingLossMW()) < 1e-6;
}

/** MW with one decimal, or two below 1 MW. */
function mwv(x: number) {
  return x === 0 ? '0 MW' : fmt(x, x < 1 ? 2 : 1) + ' MW';
}

function share(x: number) {
  return fmt(x * 100, x < 0.01 ? 2 : 1) + '%';
}

/** One conductor, sagging between the towers. */
function conductor(y: number, sag = 11) {
  let d = `M${SPANS[0]} ${y}`;
  for (let i = 1; i < SPANS.length; i++) d += ` Q${(SPANS[i - 1] + SPANS[i]) / 2} ${y + 2 * sag} ${SPANS[i]} ${y}`;
  return d;
}

function Tower({ x }: { x: number }) {
  return (
    <path
      d={`M${x - 12} 140 L${x - 3} 56 L${x + 3} 56 L${x + 12} 140 M${x - 8} 104 L${x + 8} 104 M${x - 16} 62 L${x + 16} 62 M${x - 14} 73 L${x + 14} 73 M${x - 12} 84 L${x + 12} 84`}
      fill="none"
      stroke="#9a9a9a"
      strokeWidth={2}
    />
  );
}

export default function Lesson() {
  const play = usePlay(true);
  const s = useScenario('line', LINE_DEFAULTS);
  const { sendMW, kvIdx, lengthKm, ohmPerKm } = s.state;
  const kV = KV[kvIdx];
  const r = lineLoss({ sendMW, kV, lengthKm, ohmPerKm });
  const impossible = r.lossShare >= 1 - 1e-12;
  const perMeterW = (r.amps * r.amps * ohmPerKm) / 1000; // heat per meter of one conductor
  const heat = Math.min(1, Math.log10(1 + perMeterW) / Math.log10(151));
  const wireColor = mix('#9a9a9a', RED, heat);
  const dotSpeed = Math.min(160, 0.05 * r.amps); // px per second, proportional to current
  const dotStyle = {
    animationDuration: `${(18 / Math.max(dotSpeed, 1e-3)).toFixed(3)}s`,
    animationPlayState: play.playing && dotSpeed > 0.01 ? ('running' as const) : ('paused' as const),
  };
  const endY = CHART_TOP + CHART_H * r.lossShare;
  const solved = reachSolved(s.state);
  const rating = thermalRatingAmps(ohmPerKm);
  const overRating = r.amps > rating;
  const GW = LX1 - LX0; // the gauge spans 0 to twice the rating
  const ratingX = LX0 + GW / 2;
  const barW = GW * Math.min(1, r.amps / (2 * rating));

  const s2 = useScenario('classes', { sendMW: 500, lengthKm: 300, conductor: 'typical' as 'typical' | 'same' });
  const rows = KV.map((v) => {
    const ohm = s2.state.conductor === 'typical' ? TYPICAL_OHM_PER_KM[v] : SAME_OHM_PER_KM;
    const res = lineLoss({ sendMW: s2.state.sendMW, kV: v, lengthKm: s2.state.lengthKm, ohmPerKm: ohm });
    const impossible = res.lossShare >= 1 - 1e-12;
    return { kV: v, ohm, res, impossible, impractical: !impossible && res.lossShare > IMPRACTICAL_SHARE };
  });
  const firstUnder2 = rows.find((x) => x.res.lossShare < 0.02);
  const bx = (i: number) => 110 + i * 88;
  const by = scale(0, IMPRACTICAL_SHARE, 220, 40);

  return (
    <LessonPage id="1.5">
      <P>
        In <a href={lessonHref('1.1')}>Lesson 1.1</a> we saw that a wire carries whatever current its loads draw, and that the heat it wastes, <K c="current">I</K>²
        <K c="resistance">R</K>, grows with the square of that current. The previous lesson gave us a way to do something about it. A transformer trades voltage for
        current almost for free, so a power plant can send the same power with less current simply by raising the voltage. This lesson measures what that’s worth.
      </P>
      <P>
        In the next demonstration, a power plant sends power to a city over a three-phase transmission line. Each of the line’s three conductors has <K c="resistance">resistance</K>, so each
        turns <K c="current">I</K>²<K c="resistance">R</K> into heat, and the line as a whole loses three times as much. The chart underneath follows the{' '}
        <K c="power">power</K> still traveling along the line, kilometer by kilometer. Adjust the line:
      </P>

      <Figure name="Transmission Loss Simulator" scenario={s} play={play}>
        <svg
          className="diagram"
          viewBox={`0 0 640 ${306 + GAUGE_SHIFT}`}
          role="img"
          aria-label={`A ${kV} kV line ${lengthKm} km long carrying ${mw(sendMW)} from a power plant to a city. Each conductor carries ${fmt(r.amps)} A against a thermal rating of ${fmt(rating)} A${overRating ? ', more than it may' : ''}. ${impossible ? 'It cannot deliver that much power.' : `It delivers ${mwv(r.deliveredMW)} and loses ${mwv(r.lossMW)}, ${share(r.lossShare)}, as heat.`}`}
        >
          <text className="ax" x={LX0} y={14}>
            Current in each conductor
          </text>
          <text x={LX1} y={14} textAnchor="end" style={{ fontSize: 13, fontWeight: 500, fill: overRating ? '#c4382f' : '#ad5310' }}>
            {fmt(r.amps)} A{overRating ? ' — over its thermal rating' : ''}
          </text>
          <rect x={LX0} y={22} width={GW} height={10} rx={5} fill="#ececec" />
          <rect x={LX0} y={22} width={barW} height={10} rx={5} fill={overRating ? RED : '#e48850'} />
          <line x1={ratingX} x2={ratingX} y1={18} y2={36} stroke="#444" strokeWidth={2} />
          <text className="ax ax-m" x={ratingX} y={50}>
            thermal rating {fmt(rating)} A
          </text>
          <g transform={`translate(0 ${GAUGE_SHIFT})`}>
            <line className="base" x1={16} y1={140} x2={624} y2={140} />
            <rect x={26} y={96} width={58} height={44} fill="#e6e6e6" stroke="#9a9a9a" strokeWidth={1.5} />
            <rect x={60} y={64} width={12} height={32} fill="#e6e6e6" stroke="#9a9a9a" strokeWidth={1.5} />
            <rect x={556} y={102} width={18} height={38} fill="#e6e6e6" stroke="#9a9a9a" strokeWidth={1.5} />
            <rect x={576} y={84} width={20} height={56} fill="#e6e6e6" stroke="#9a9a9a" strokeWidth={1.5} />
            <rect x={598} y={110} width={20} height={30} fill="#e6e6e6" stroke="#9a9a9a" strokeWidth={1.5} />
            <path d={`M${LX0} 140 L${LX0} 58 M${LX1} 140 L${LX1} 58`} stroke="#9a9a9a" strokeWidth={3} />
            {SPANS.slice(1, -1).map((x) => (
              <Tower key={x} x={x} />
            ))}
            {[62, 73, 84].map((y) => (
              <path key={'h' + y} d={conductor(y)} fill="none" stroke={RED} strokeWidth={10} opacity={0.18 * heat} />
            ))}
            {[62, 73, 84].map((y) => (
              <path key={'w' + y} d={conductor(y)} fill="none" stroke={wireColor} strokeWidth={2.5} />
            ))}
            {[62, 73, 84].map((y) => (
              <path key={'d' + y} d={conductor(y)} className="flow-dots" stroke="#e48850" strokeWidth={5} style={dotStyle} />
            ))}
            <text className="ax ax-m" x={55} y={158}>
              power plant
            </text>
            <text className="ax ax-m" x={587} y={158}>
              city
            </text>

            <text className="ax" x={LX0} y={176}>
              Power along the line
            </text>
            {impossible ? (
              <g>
                <rect x={LX0} y={CHART_TOP} width={LX1 - LX0} height={CHART_H} fill={tint(RED, 0.18)} stroke="#c4382f" strokeWidth={1.5} strokeDasharray="5 4" />
                <text x={(LX0 + LX1) / 2} y={CHART_TOP + CHART_H / 2 + 5} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: '#c4382f' }}>
                  At {kV} kV, this line can’t carry {mw(sendMW)}
                </text>
              </g>
            ) : (
              <g>
                <path d={`M${LX0} ${CHART_TOP} L${LX1} ${endY} L${LX1} ${CHART_TOP + CHART_H} L${LX0} ${CHART_TOP + CHART_H} Z`} fill={tint(RED, 0.28)} />
                <path d={`M${LX0} ${CHART_TOP} L${LX1} ${CHART_TOP} L${LX1} ${endY} Z`} fill={RED} opacity={0.85} />
              </g>
            )}
            <line className="base" x1={LX0} y1={CHART_TOP + CHART_H} x2={LX1} y2={CHART_TOP + CHART_H} />
            <text x={LX0 - 8} y={CHART_TOP + 5} textAnchor="end" style={{ fontSize: 13, fontWeight: 500, fill: '#c4382f' }}>
              {mw(sendMW)}
            </text>
            <text className="ax ax-e" x={LX0 - 8} y={CHART_TOP + 21}>
              sent
            </text>
            {!impossible && (
              <g>
                <text x={LX1} y={CHART_TOP - 6} textAnchor="end" style={{ fontSize: 13, fontWeight: 500, fill: '#c4382f' }}>
                  {mwv(r.lossMW)} lost as heat, {share(r.lossShare)}
                </text>
                <text x={LX1 + 8} y={Math.min(endY, CHART_TOP + CHART_H - 16) + 5} style={{ fontSize: 13, fontWeight: 500, fill: '#c4382f' }}>
                  {mwv(r.deliveredMW)}
                </text>
                <text className="ax" x={LX1 + 8} y={Math.min(endY, CHART_TOP + CHART_H - 16) + 21}>
                  delivered
                </text>
              </g>
            )}
            <text className="ax" x={LX0} y={CHART_TOP + CHART_H + 16}>
              0 km
            </text>
            <text className="ax ax-e" x={LX1} y={CHART_TOP + CHART_H + 16}>
              {lengthKm} km
            </text>
          </g>
        </svg>
        <Slider label="Power sent" tone="red" value={sendMW} min={10} max={1000} step={10} onChange={(v) => s.set({ sendMW: v })} display={mw(sendMW)} />
        <Slider label="Line voltage" tone="blue" value={kvIdx} min={0} max={KV.length - 1} onChange={(v) => s.set({ kvIdx: v })} display={`${kV} kV`} />
        <Slider label="Length" value={lengthKm} min={10} max={500} step={10} onChange={(v) => s.set({ lengthKm: v })} display={`${lengthKm} km`} />
        <Slider
          label="Conductor resistance"
          tone="violet"
          value={ohmPerKm}
          min={0.01}
          max={0.3}
          step={0.005}
          onChange={(v) => s.set({ ohmPerKm: v })}
          display={`${ohmPerKm.toFixed(3)} Ω per km`}
        />
        <Eq label="Loss equals three times current squared times resistance">
          <K c="power">Loss</K>
          <Op>=</Op>
          <span>3</span>
          <Op>×</Op>
          <K c="current">
            I<Sup>2</Sup>
          </K>
          <Op>×</Op>
          <K c="resistance">R</K>
          <Op>=</Op>
          <span>3</span>
          <Op>×</Op>
          <K c="current">
            ({fmt(r.amps)} A)<Sup>2</Sup>
          </K>
          <Op>×</Op>
          <K c="resistance">{fmt(r.ohms, 1)} Ω</K>
          <Op>=</Op>
          <K c="power">{impossible ? `more than the ${mw(sendMW)} sent` : mwv(r.lossMW)}</K>
        </Eq>
      </Figure>

      <P>The current in each conductor is the power divided by √3 times the line’s voltage:</P>
      <Eq label="Current equals power divided by root three times voltage">
        <K c="current">I</K>
        <Op>=</Op>
        <Frac
          top={<K c="power">P</K>}
          bottom={
            <>
              √3 × <K c="voltage">V</K>
            </>
          }
        />
        <Op>=</Op>
        <Frac
          top={<K c="power">{mw(sendMW)}</K>}
          bottom={
            <>
              √3 × <K c="voltage">{kV} kV</K>
            </>
          }
        />
        <Op>=</Op>
        <K c="current">{fmt(r.amps)} A</K>
      </Eq>
      <P>
        The √3 is there because, as <a href={lessonHref('1.4')}>Lesson 1.4</a> explained, a three-phase line’s voltage is quoted line to line, between two of its
        conductors. Each conductor carries a third of the power at the line-to-neutral voltage, <K c="voltage">V</K>/√3, and dividing one by the other gives the
        formula. At the starting settings, the plant sends 100 MW at 69 kV, and that’s 837 A in each conductor. The line is 100 km long, and at 0.15 Ω per kilometer
        each conductor has 15 Ω of resistance from end to end, so the line turns 31.5 MW into heat — almost a third of everything sent, or 315 kW along every
        kilometer.
      </P>
      <P>
        Now raise the voltage to 138 kV. The <K c="voltage">voltage</K> doubles, so the <K c="current">current</K> halves, to 418 A — and because the loss grows with the
        square of the current, it falls to a quarter: 7.9 MW. At 345 kV, five times the starting voltage, the loss is 25 times smaller, just 1.3 MW. Length and
        resistance act more simply. Double either and the loss doubles, because the same current now flows through twice the resistance.
      </P>
      <P>
        Sending more power over the same line costs a bigger share of it, not just more megawatts. Send twice as much at the same voltage and the current doubles, so
        the loss quadruples and the share lost doubles: at the starting settings, 200 MW instead of 100 MW would lose 63% instead of 31.5%. Long, heavily loaded lines
        are where high voltage pays off most.
      </P>

      <Challenge
        id="a"
        question="Run the line at 138 kV, twice the starting voltage, but keep the starting 100 MW and 0.150 Ω per km. How long must it be to lose the same 31.5 MW that the starting 100 km line loses at 69 kV?"
        solved={solved}
        status={
          kV !== CHALLENGE_KV
            ? `Right now the line runs at ${kV} kV.`
            : sendMW !== LINE_DEFAULTS.sendMW || Math.abs(ohmPerKm - LINE_DEFAULTS.ohmPerKm) > 1e-9
              ? 'Set the power back to 100 MW and the conductor back to 0.150 Ω per km.'
              : `At ${lengthKm} km, the line loses ${mwv(r.lossMW)}.`
        }
        success="Solved. Twice the voltage means half the current, and since the loss grows with the square of the current, each kilometer loses only a quarter as much. It takes four times the length, 400 km, to lose the same 31.5 MW."
      />

      <P>
        The heat matters for a second reason. A conductor warms up as it carries current, and a warm conductor expands and sags closer to the ground — or to the trees
        beneath it. To keep a safe clearance, every conductor has a limit on the current it may carry, set by how hot it can safely get — its <b>thermal rating</b>.
        The bar at the top of this demonstration compares the current in each conductor with an illustrative rating for a conductor of its resistance: a thicker
        conductor has less resistance and more surface to shed heat, so it can carry more. The starting conductor is rated at 600 A, so at 69 kV its 837 A is far over
        the limit, while at 138 kV the 418 A fits comfortably. On many lines it’s this limit, more than the cost of the lost energy, that caps how much power the line
        can deliver. We’ll meet these limits again in Chapter 2, where they shape how power moves through a whole network.
      </P>
      <P>
        Even with its thermal rating, this demonstration is kinder than reality, because it counts only resistance. Real lines are also limited by the voltage sagging
        along a long, heavily loaded line, and by the line’s <b>reactance</b>, an opposition to alternating current that comes from the magnetic field around its
        conductors. On high-voltage lines the reactance is several times the resistance, and it’s the reactance, not the resistance, that decides how power divides
        between the different paths through a network. That’s the subject of <a href={lessonHref('2.4')}>Lesson 2.4</a>.
      </P>

      <H2>Choosing a voltage</H2>
      <P>
        Lowering the resistance works too, but only by using thicker conductors: more aluminum, heavier wires and stronger towers. In practice the two go together —
        higher-voltage lines are usually built with larger conductors, often bundled two or more to a phase — and the voltage does most of the work. The next chart
        compares common North American line voltages for a single job, each with a typical conductor for its voltage:
      </P>

      <Figure name="Transmission Loss Simulator · voltage classes" scenario={s2}>
        <Segmented
          label="Conductors"
          value={s2.state.conductor}
          onChange={(v) => s2.set({ conductor: v })}
          options={[
            { value: 'typical', label: 'Typical conductors' },
            { value: 'same', label: 'Same conductor' },
          ]}
        />
        <svg
          className="chart"
          viewBox="0 0 600 266"
          role="img"
          aria-label={`Share of ${mw(s2.state.sendMW)} lost over ${s2.state.lengthKm} km at each voltage: ${rows.map((x) => `${x.kV} kV ${x.impossible ? 'not possible' : x.impractical ? `${share(x.res.lossShare)}, impractical` : share(x.res.lossShare)}`).join(', ')}.`}
        >
          <text className="ax" x={60} y={22}>
            Share of the power lost
          </text>
          <GridY y={by} ticks={[0, 0.05, 0.1, 0.15, 0.2]} x0={60} x1={590} format={(v) => `${Math.round(v * 100)}%`} baseline={0} />
          {rows.map((x, i) =>
            x.impossible ? (
              <g key={x.kV}>
                <rect
                  x={bx(i) - 26}
                  y={by(IMPRACTICAL_SHARE)}
                  width={52}
                  height={by(0) - by(IMPRACTICAL_SHARE)}
                  fill={tint(RED, 0.18)}
                  stroke="#c4382f"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
                <text x={bx(i)} y={124} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: '#c4382f' }}>
                  can’t be
                </text>
                <text x={bx(i)} y={140} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: '#c4382f' }}>
                  done
                </text>
              </g>
            ) : x.impractical ? (
              <g key={x.kV}>
                <rect
                  x={bx(i) - 26}
                  y={by(IMPRACTICAL_SHARE)}
                  width={52}
                  height={by(0) - by(IMPRACTICAL_SHARE)}
                  fill={tint(RED, 0.08)}
                  stroke="#c4382f"
                  strokeWidth={1.5}
                  strokeDasharray="2 4"
                />
                <text x={bx(i)} y={124} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: '#c4382f' }}>
                  impractical
                </text>
                <text x={bx(i)} y={140} textAnchor="middle" style={{ fontSize: 12, fill: '#c4382f' }}>
                  {fmt(x.res.lossShare * 100)}% lost
                </text>
              </g>
            ) : (
              <g key={x.kV}>
                <rect x={bx(i) - 26} y={by(x.res.lossShare)} width={52} height={by(0) - by(x.res.lossShare)} fill={RED} />
                <text x={bx(i)} y={by(x.res.lossShare) - 6} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: '#c4382f' }}>
                  {share(x.res.lossShare)}
                </text>
              </g>
            ),
          )}
          {rows.map((x, i) => (
            <g key={'l' + x.kV}>
              <text className="lab" x={bx(i)} y={240} textAnchor="middle">
                {x.kV} kV
              </text>
              <text className="ax ax-m" x={bx(i)} y={256}>
                {x.ohm} Ω/km
              </text>
            </g>
          ))}
        </svg>
        <Slider
          label="Power sent"
          tone="red"
          value={s2.state.sendMW}
          min={100}
          max={1000}
          step={10}
          onChange={(v) => s2.set({ sendMW: v })}
          display={mw(s2.state.sendMW)}
        />
        <Slider
          label="Length"
          value={s2.state.lengthKm}
          min={50}
          max={500}
          step={10}
          onChange={(v) => s2.set({ lengthKm: v })}
          display={`${s2.state.lengthKm} km`}
        />
        <Caption>
          {firstUnder2
            ? `The lowest of these voltages that keeps the loss under 2% is ${firstUnder2.kV} kV.`
            : 'None of these voltages keeps the loss under 2%.'}
        </Caption>
      </Figure>

      <P>
        Sending 500 MW over 300 km, a 69 kV line can’t do the job at all: it would need 4,184 A in each conductor, and its resistance would swallow more than everything
        sent. At 138 kV it would lose 63% of the power, far past anything worth building, so the chart marks it impractical rather than drawing it. At 230 kV the line
        loses 14%, at 345 kV 3.8%, at 500 kV 1.2%, and at 765 kV just 0.3%. Switch to the same conductor for every voltage and the differences shrink, but they don’t
        disappear: with the conductor fixed, the loss falls with the square of the voltage.
      </P>
      <P>
        Now try the sliders. At a fixed voltage the loss grows with the square of the current, but the power sent grows only in proportion to it, so the share lost
        rises in proportion to both the power and the distance. Drag either one up and every bar rises in step, and the lowest voltage that can do the job climbs with
        them.
      </P>
      <P>
        Why not go higher still? Every step up in voltage needs longer insulators, wider clearances, taller towers and costlier transformers and switchgear. At very high
        voltages the air around the conductors also starts to break down, leaking energy in a faint glow and crackle called corona. So grids use a ladder of voltages: the
        highest for moving large amounts of power across long distances, and lower ones for shorter, smaller jobs.
      </P>
      <P>
        Across a whole grid, the losses add up. In the United States, the Energy Information Administration estimates that transmission and distribution together lose
        about 5% of the electricity they carry, and more of it is lost in the lower-voltage distribution networks than on the high-voltage transmission lines. On a grid
        serving 10,000 MW of demand, 5% is 500 MW — the output of a large power plant — spent heating wires.
      </P>
      <P>
        That completes the physics we need. Generators turn motion into alternating voltage, transformers trade voltage for current, and high-voltage lines carry power a
        long way with little waste. In Chapter 2 we’ll put these pieces together into a grid: the power plants, the transmission and distribution networks, and the
        substations that join them — and we’ll see how power decides which path to take.
      </P>
    </LessonPage>
  );
}
