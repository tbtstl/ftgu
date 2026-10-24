import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, fmt, lessonHref, pct, useScenario } from '../../../framework';
import { COMPONENTS, bubblePoint, dewPoint, flash, relativeVolatility, stages, txy, type Component } from '../../../engines/oil/phase';
import { rng } from '../../../model/random';

type PairId = 'hexOct' | 'hepOct' | 'penDec';
const PAIRS: Record<PairId, { light: Component; heavy: Component; label: string }> = {
  hexOct: { light: COMPONENTS.hexane, heavy: COMPONENTS.octane, label: 'Hexane + octane' },
  hepOct: { light: COMPONENTS.heptane, heavy: COMPONENTS.octane, label: 'Heptane + octane' },
  penDec: { light: COMPONENTS.pentane, heavy: COMPONENTS.decane, label: 'Pentane + decane' },
};
const LIGHT = '#4590ce';
const HEAVY = '#d0702a';

function degC(t: number): string {
  return `${fmt(t, 1)} °C`;
}

/** Challenge a: half the hexane–octane mixture (by molecules) boiled, at 1 atm from 50/50. */
export function halfBoiledSolved(pair: PairId, z: number, p: number, t: number): boolean {
  if (pair !== 'hexOct' || z !== 50 || p !== 1) return false;
  const f = flash([COMPONENTS.hexane, COMPONENTS.octane], [0.5, 0.5], t, 1);
  return Math.abs(f.vapor - 0.5) <= 0.03;
}

/** Challenge b: the fewest stages that lift heptane–octane from 50% to at least 95% heptane at 1 atm. */
export function fewestStagesSolved(pair: PairId, z: number, n: number): boolean {
  if (pair !== 'hepOct' || z !== 50) return false;
  const st = stages(COMPONENTS.heptane, COMPONENTS.octane, 0.5, 1, n);
  const reached = (k: number) => k > 0 && st[k - 1].vapor >= 0.95;
  return reached(n) && !reached(n - 1);
}

/** Fixed dot positions inside a box, so the picture doesn't jump as sliders move. */
const SPOTS = (() => {
  const r = rng(7);
  return Array.from({ length: 80 }, () => [r(), r()] as [number, number]);
})();

/** A closed vessel with the mixture split into vapor and liquid; each dot is a share of the molecules. */
function Vessel({ vapor, xLight, yLight, lightName }: { vapor: number; xLight: number; yLight: number; lightName: string }) {
  const N = 60;
  const nV = Math.round(vapor * N);
  const nL = N - nV;
  const X = 40;
  const W = 220;
  const TOP = 30;
  const H = 210;
  // The liquid is dense, so it takes a small part of the vessel however much of the mixture it holds.
  const liqH = nL > 0 ? 34 + (nL / N) * 70 : 0;
  const liqTop = TOP + H - liqH;
  const lightL = Math.round(xLight * nL);
  const lightV = Math.round(yLight * nV);
  const dots: Array<{ x: number; y: number; c: string }> = [];
  for (let i = 0; i < nL; i++) {
    const cols = Math.max(1, Math.ceil(Math.sqrt((nL * W) / liqH)));
    const row = Math.floor(i / cols);
    const col = i % cols;
    const rows = Math.ceil(nL / cols);
    dots.push({ x: X + 10 + ((col + 0.5) / cols) * (W - 20), y: liqTop + 8 + ((row + 0.5) / rows) * (liqH - 16), c: i < lightL ? LIGHT : HEAVY });
  }
  for (let i = 0; i < nV; i++) {
    const [u, v] = SPOTS[i];
    dots.push({ x: X + 10 + u * (W - 20), y: TOP + 10 + v * Math.max(10, liqTop - TOP - 22), c: i < lightV ? LIGHT : HEAVY });
  }
  return (
    <g>
      <rect x={X} y={TOP} width={W} height={H} rx={18} fill="#fbfbf9" stroke="#9a9a9a" strokeWidth={2} />
      {nL > 0 && <rect x={X + 2} y={liqTop} width={W - 4} height={liqH - 2} rx={nL === N ? 16 : 2} fill="#e9e4d6" />}
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={4.2} fill={d.c} />
      ))}
      <text x={X + W / 2} y={TOP - 10} textAnchor="middle" className="ax">
        {nV === 0 ? 'all liquid' : nL === 0 ? 'all vapor' : `vapor: ${pct(yLight)} ${lightName.toLowerCase()}`}
      </text>
      {nL > 0 && nV > 0 && (
        <text x={X + W / 2} y={TOP + H + 18} textAnchor="middle" className="ax">
          liquid: {pct(xLight)} {lightName.toLowerCase()}
        </text>
      )}
    </g>
  );
}

export default function Lesson() {
  const s = useScenario('flash', { pair: 'hexOct' as PairId, z: 50, p: 1, t: 80 });
  const { pair, z, p, t } = s.state;
  const { light, heavy } = PAIRS[pair];
  const zf = z / 100;
  const comps = [light, heavy];
  const f = flash(comps, [zf, 1 - zf], t, p);
  const bub = bubblePoint(comps, [zf, 1 - zf], p);
  const dew = dewPoint(comps, [zf, 1 - zf], p);
  const curve = useMemo(() => txy(light, heavy, p, 51), [light, heavy, p]);
  const tLo = Math.floor((curve[curve.length - 1].bubble - 15) / 10) * 10;
  const tHi = Math.ceil((curve[0].bubble + 15) / 10) * 10;
  const tMin = 0;
  const tMax = 220;

  const s2 = useScenario('stages', { pair: 'hepOct' as PairId, z: 50, n: 2 });
  const P2 = PAIRS[s2.state.pair];
  const st = stages(P2.light, P2.heavy, s2.state.z / 100, 1, s2.state.n);
  const top = st[st.length - 1];

  const hexOct = [COMPONENTS.hexane, COMPONENTS.octane];
  const b50 = bubblePoint(hexOct, [0.5, 0.5], 1);
  const d50 = dewPoint(hexOct, [0.5, 0.5], 1);
  const firstVapor = flash(hexOct, [0.5, 0.5], b50 + 1e-6, 1).y[0];
  const hep4 = stages(COMPONENTS.heptane, COMPONENTS.octane, 0.5, 1, 4);

  const solvedA = halfBoiledSolved(pair, z, p, t);
  const solvedB = fewestStagesSolved(s2.state.pair, s2.state.z, s2.state.n);

  return (
    <LessonPage id="oil/1.4">
      <P>
        A pure compound has a boiling point. Put water on a stove at sea level and it boils at 100 °C, and stays at 100 °C until the last of it is gone. In{' '}
        <a href={lessonHref('oil/1.1')}>Lesson 1.1</a> we read boiling points for single molecules, and in <a href={lessonHref('oil/1.2')}>Lesson 1.2</a> we divided crude
        oil into cuts by boiling range. But crude is a mixture, and a mixture doesn’t have a boiling point. It has a range, and what boils off first isn’t a sample of
        the whole. That difference is the physics every refinery is built on.
      </P>
      <P>
        Let’s take the simplest mixture that shows it: two alkanes, closed in a vessel at a fixed pressure. At any temperature, each kind of molecule has a{' '}
        <K tone="blue">vapor pressure</K> — the pressure its vapor reaches when it’s in balance with the liquid. Light molecules escape the liquid easily and have high
        vapor pressures; heavy ones, low. A pure liquid boils when its vapor pressure reaches the pressure around it. In a mixture, each component contributes in
        proportion to its share of the liquid, and the mixture starts to boil when the contributions add up to the surrounding pressure. That’s Raoult’s law, and for
        hydrocarbons as alike as these it is a good approximation.
      </P>
      <P>
        In the next demonstration, blue dots are the light component and orange the heavy one; each dot stands for a share of the molecules, not their volume. The chart
        is the mixture’s <b>boiling diagram</b>. Set the temperature, the pressure and the starting mixture:
      </P>

      <Figure name="Phase Equilibrium Explorer" scenario={s}>
        <Segmented label="Mixture" value={pair} onChange={(v) => s.set({ pair: v })} options={(Object.keys(PAIRS) as PairId[]).map((k) => ({ value: k, label: PAIRS[k].label }))} />
        <Legend
          items={[
            { label: light.name, color: LIGHT },
            { label: heavy.name, color: HEAVY },
            { label: 'Starts to boil (bubble point)', color: '#4590ce', kind: 'line' },
            { label: 'Fully vapor (dew point)', color: '#e75b55', kind: 'line' },
          ]}
        />
        <svg
          className="diagram"
          viewBox="0 0 640 280"
          role="img"
          aria-label={`A closed vessel of ${light.name.toLowerCase()} and ${heavy.name.toLowerCase()}, ${z}% ${light.name.toLowerCase()}, at ${degC(t)} and ${fmt(p, 2)} atm: ${f.phase === 'two-phase' ? `${pct(f.vapor)} of the molecules are vapor; the vapor is ${pct(f.y[0])} ${light.name.toLowerCase()} and the liquid ${pct(f.x[0])}` : f.phase === 'liquid' ? 'all liquid' : 'all vapor'}.`}
        >
          <Vessel vapor={f.vapor} xLight={f.x[0]} yLight={f.y[0]} lightName={light.name} />
          <g transform="translate(300 0)">
            <TxyMini curve={curve} t={t} tLo={tLo} tHi={tHi} z={zf} f={f} />
          </g>
        </svg>
        <Readouts
          items={[
            { label: 'boiled, share of molecules', value: pct(f.vapor) },
            { label: <K tone="red">starts to boil</K>, value: degC(bub), tone: 'red' },
            { label: <K tone="red">fully vapor</K>, value: degC(dew), tone: 'red' },
          ]}
        />
        <Slider label="Temperature" tone="red" value={t} min={tMin} max={tMax} step={0.5} onChange={(v) => s.set({ t: v })} display={degC(t)} />
        <Slider label="Pressure" tone="blue" value={p} min={0.2} max={3} step={0.05} onChange={(v) => s.set({ p: Math.round(v * 100) / 100 })} display={`${fmt(p, 2)} atm`} />
        <Slider label={`${light.name} in the mixture`} value={z} min={0} max={100} onChange={(v) => s.set({ z: v })} display={`${z}%`} />
        <Caption>
          {f.phase === 'liquid'
            ? `At ${degC(t)} the mixture is all liquid. It starts to boil at ${degC(bub)}.`
            : f.phase === 'vapor'
              ? `At ${degC(t)} the mixture is all vapor.`
              : `Between its bubble and dew points the mixture is part vapor, part liquid. The vapor is richer in ${light.name.toLowerCase()} (${pct(f.y[0])}) than the liquid (${pct(f.x[0])}).`}
        </Caption>
      </Figure>

      <P>
        Start with the half-and-half mixture of hexane and octane at 1 atm, and warm it. Nothing happens until {degC(b50)}, between hexane’s boiling point of 68.7 °C and
        octane’s 125.7 °C. There the first bubbles appear, and they are not half and half: the first vapor is {pct(firstVapor)} hexane. Keep heating and more of the
        mixture boils, but the temperature has to keep climbing, because the liquid left behind is ever richer in octane. The last drop disappears at {degC(d50)}.
      </P>
      <P>
        The chart shows the whole story. The lower curve marks where each mixture starts to boil, the <b>bubble point</b>; the upper curve where it finishes, the{' '}
        <b>dew point</b>. Between them, the horizontal line at the current temperature connects the composition of the liquid, on the lower curve, to the composition of
        the vapor in balance with it, on the upper curve. However the mixture starts, the vapor is always richer in the lighter component.
      </P>

      <Challenge
        id="a"
        question="With a half-and-half mixture of hexane and octane at 1 atm, find the temperature at which half of the molecules have boiled."
        solved={solvedA}
        status={pair !== 'hexOct' || z !== 50 || p !== 1 ? 'Set the mixture to hexane + octane, 50% hexane, at 1 atm.' : `At ${degC(t)}, ${pct(f.vapor)} of the molecules have boiled.`}
        success={`Solved: about ${degC(t)}. Half the molecules are vapor, but the two halves aren’t alike: the vapor is ${pct(f.y[0])} hexane and the liquid only ${pct(f.x[0])}. Heating has partly separated the mixture.`}
      />

      <H2>Pressure</H2>
      <P>
        Now drag the pressure. Lowering it lowers every boiling point, because the molecules need less vapor pressure to escape: at half an atmosphere, the same
        mixture starts to boil at {degC(bubblePoint(hexOct, [0.5, 0.5], 0.5))}. Raising it does the opposite. This matters a great deal for crude oil. The heaviest
        molecules would need temperatures so high to boil at atmospheric pressure that they would break apart first, as we saw in{' '}
        <a href={lessonHref('oil/1.2')}>Lesson 1.2</a>. So refineries boil the heavy end of the crude a second time, in a column held at a small fraction of atmospheric
        pressure. We’ll see that column in <a href={lessonHref('oil/3.1')}>Lesson 3.1</a>.
      </P>

      <H2>Stage after stage</H2>
      <P>
        One boiling makes a vapor richer in the light component, but not pure. To go further, condense that vapor and boil it again: the second vapor is richer still.
        Each round of boiling and condensing is called an equilibrium <b>stage</b>. The next demonstration chains stages together, each one boiling the liquid condensed
        from the one beneath it, at atmospheric pressure. The bars show the light component’s share in the vapor leaving each stage:
      </P>

      <Figure name="Phase Equilibrium Explorer · stages" scenario={s2}>
        <Segmented label="Mixture" value={s2.state.pair} onChange={(v) => s2.set({ pair: v })} options={(Object.keys(PAIRS) as PairId[]).map((k) => ({ value: k, label: PAIRS[k].label }))} />
        <StageStack stages={st} light={P2.light} heavy={P2.heavy} z={s2.state.z / 100} />
        <Readouts
          items={[
            { label: `${P2.light.name.toLowerCase()} in the top vapor`, value: pct(top.vapor, 1), tone: 'blue' },
            { label: <K tone="red">top stage boils at</K>, value: degC(top.t), tone: 'red' },
          ]}
        />
        <Slider label="Stages" value={s2.state.n} min={1} max={8} onChange={(v) => s2.set({ n: v })} display={`${s2.state.n}`} />
        <Slider label={`${P2.light.name} in the starting liquid`} value={s2.state.z} min={5} max={95} onChange={(v) => s2.set({ z: v })} display={`${s2.state.z}%`} />
      </Figure>

      <P>
        How quickly the stages separate a mixture depends on how different its components’ vapor pressures are. The ratio of the two, called the{' '}
        <b>relative volatility</b>, is what each stage multiplies: across their boiling range, hexane’s vapor pressure is about {fmt(relativeVolatility(COMPONENTS.hexane, COMPONENTS.octane, 100))}{' '}
        times octane’s, heptane’s only about {fmt(relativeVolatility(COMPONENTS.heptane, COMPONENTS.octane, 110), 1)} times. Pentane and decane, five carbons apart, are
        almost completely separated by a single stage. Hexane and octane need about three for 99%. Heptane and octane differ by a single carbon, and each stage gains
        less: from 50% heptane, four stages reach {pct(hep4[3].vapor, 1)}. Molecules that boil close together are the hardest to separate, and the most expensive.
      </P>

      <Challenge
        id="b"
        question="Starting from a half-and-half liquid of heptane and octane, find the fewest stages that give a vapor at least 95% heptane."
        solved={solvedB}
        status={
          s2.state.pair !== 'hepOct' || s2.state.z !== 50
            ? 'Choose heptane + octane, starting from 50% heptane.'
            : `${s2.state.n} stage${s2.state.n > 1 ? 's' : ''}: ${pct(top.vapor, 1)} heptane at the top.`
        }
        success={`Solved: ${s2.state.n} stages, giving ${pct(top.vapor, 1)} heptane. A distillation column stacks dozens of stages in one tower, and runs them continuously instead of one batch at a time.`}
      />

      <P>
        A <b>distillation column</b> is exactly this, built continuously. It’s a tall tower filled with trays. Vapor rises through holes in each tray and bubbles through
        the liquid sitting on it; liquid flows down from tray to tray. On every tray the rising vapor and falling liquid come close to balance, so every tray acts as a
        stage. The top of the column is cool and holds the lightest molecules; the bottom is hot and holds the heaviest; and each tray in between has its own temperature
        and its own mixture, just like the stages in <FigRef to="Phase Equilibrium Explorer · stages">this demonstration</FigRef>.
      </P>
      <P>
        Crude oil isn’t two components but thousands, with boiling points spread almost continuously from below freezing to beyond 550 °C. A column can’t pull out pure
        compounds from that, and a refinery doesn’t want it to. Instead it draws off streams at different heights, each a band of boiling points: the cuts of{' '}
        <a href={lessonHref('oil/1.2')}>Lesson 1.2</a>. We’ll build that column in Chapter 3. First, though, one more property decides what those cuts are worth: the
        energy each one releases when it burns. That is the subject of the <a href={lessonHref('oil/1.5')}>next lesson</a>.
      </P>
    </LessonPage>
  );
}

/** The boiling diagram: bubble and dew curves, the tie line at the current temperature, and the feed. */
function TxyMini({
  curve,
  t,
  tLo,
  tHi,
  z,
  f,
}: {
  curve: Array<{ x: number; bubble: number; dew: number }>;
  t: number;
  tLo: number;
  tHi: number;
  z: number;
  f: ReturnType<typeof flash>;
}) {
  const X0 = 46;
  const X1 = 330;
  const Y0 = 236;
  const Y1 = 24;
  const sx = (x: number) => X0 + x * (X1 - X0);
  const sy = (v: number) => Y0 - ((Math.min(tHi, Math.max(tLo, v)) - tLo) / (tHi - tLo)) * (Y0 - Y1);
  const path = (k: 'bubble' | 'dew') => curve.map((c, i) => `${i ? 'L' : 'M'}${sx(c.x).toFixed(1)} ${sy(c[k]).toFixed(1)}`).join(' ');
  const ticks: number[] = [];
  const step = tHi - tLo > 120 ? 40 : 20;
  for (let v = Math.ceil(tLo / step) * step; v <= tHi; v += step) ticks.push(v);
  const inRange = t >= tLo && t <= tHi;
  return (
    <g>
      <text className="ax" x={X0} y={12}>
        Temperature
      </text>
      {ticks.map((v) => (
        <g key={v}>
          <line className="gl" x1={X0} x2={X1} y1={sy(v)} y2={sy(v)} />
          <text className="ax ax-e" x={X0 - 6} y={sy(v) + 4}>
            {v}°
          </text>
        </g>
      ))}
      <line className="base" x1={X0} x2={X1} y1={Y0} y2={Y0} />
      <path d={path('dew')} fill="none" stroke="#e75b55" strokeWidth={2.5} />
      <path d={path('bubble')} fill="none" stroke="#4590ce" strokeWidth={2.5} />
      <text className="ax" x={sx(0.02)} y={Y1 + 14}>
        vapor
      </text>
      <text className="ax ax-e" x={sx(0.98)} y={Y0 - 8}>
        liquid
      </text>
      {inRange && <line className="cur" x1={X0} x2={X1} y1={sy(t)} y2={sy(t)} />}
      {f.phase === 'two-phase' && inRange && (
        <g>
          <line x1={sx(f.x[0])} x2={sx(f.y[0])} y1={sy(t)} y2={sy(t)} stroke="#333" strokeWidth={2.5} />
          <circle cx={sx(f.x[0])} cy={sy(t)} r={5} fill="#4590ce" stroke="#fff" strokeWidth={1.5} />
          <circle cx={sx(f.y[0])} cy={sy(t)} r={5} fill="#e75b55" stroke="#fff" strokeWidth={1.5} />
        </g>
      )}
      {inRange && <circle cx={sx(z)} cy={sy(t)} r={4} fill="#333" />}
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <text key={v} className="ax ax-m" x={sx(v)} y={Y0 + 15}>
          {v * 100}%
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={Y0 + 32}>
        share of the light component
      </text>
    </g>
  );
}

/** Stages stacked bottom to top, each with the composition of the vapor it sends up. */
function StageStack({ stages: st, light, heavy, z }: { stages: ReturnType<typeof stages>; light: Component; heavy: Component; z: number }) {
  const rowH = 30;
  const H = 40 + rowH * (st.length + 1);
  const BX = 150;
  const BW = 330;
  const rows = [{ label: 'Starting liquid', share: z, t: null as number | null }, ...st.map((s, i) => ({ label: `Stage ${i + 1} vapor`, share: s.vapor, t: s.t }))];
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${H}`}
      role="img"
      aria-label={`${st.length} stages starting from ${pct(z)} ${light.name.toLowerCase()}: ${st.map((s, i) => `stage ${i + 1} vapor ${pct(s.vapor, 1)}`).join(', ')}.`}
    >
      {rows.map((r, i) => {
        const y = H - 24 - (i + 1) * rowH;
        return (
          <g key={i}>
            <text x={BX - 10} y={y + rowH / 2 + 4} textAnchor="end" style={{ fontSize: 12, fill: '#333' }}>
              {r.label}
            </text>
            <rect x={BX} y={y + 5} width={BW * r.share} height={rowH - 10} fill={LIGHT} />
            <rect x={BX + BW * r.share} y={y + 5} width={BW * (1 - r.share)} height={rowH - 10} fill={HEAVY} />
            <text x={BX + BW + 10} y={y + rowH / 2 + 4} style={{ fontSize: 12, fontWeight: 500, fill: '#333' }}>
              {pct(r.share, 1)} {light.name.toLowerCase()}
              {r.t !== null ? ` · boils at ${fmt(r.t, 1)} °C` : ''}
            </text>
          </g>
        );
      })}
      <text className="ax" x={BX} y={14}>
        ↑ each stage boils the liquid condensed from the stage beneath it · <tspan style={{ fill: LIGHT }}>{light.name}</tspan> /{' '}
        <tspan style={{ fill: HEAVY }}>{heavy.name}</tspan>
      </text>
    </svg>
  );
}
