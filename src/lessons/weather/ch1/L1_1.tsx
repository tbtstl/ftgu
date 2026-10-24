import { useMemo } from 'react';
import {
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  Sub,
  Sup,
  TEXT,
  fmt,
  linePath,
  scale,
  tint,
  useScenario,
} from '../../../framework';
import {
  EARTH_ABSORPTIVITY,
  EARTH_ALBEDO,
  K0,
  SOLAR_CONSTANT,
  latitudeBalance,
  planetBalance,
  tempAtLatitude,
  type PlanetInput,
} from '../../../engines/weather/radiation';
import { WX } from '../shared/tones';

/** Earth's observed global mean surface temperature, K. */
export const EARTH_SURFACE_K = 288;
/** The challenge: today's sunlight and albedo, and an atmosphere that brings the surface to 288 K. */
export function greenhouseSolved(p: PlanetInput): boolean {
  return p.solar === SOLAR_CONSTANT && Math.abs(p.albedo - EARTH_ALBEDO) < 1e-9 && Math.abs(planetBalance(p).surfaceK - EARTH_SURFACE_K) < 0.5;
}

/** The range of peak poleward heat transport estimated for the real Earth, PW. */
export const REAL_TRANSPORT_PW: [number, number] = [5, 6];
export function transportSolved(d: number): boolean {
  const pk = latitudeBalance(d).peakTransportPW;
  return pk >= REAL_TRANSPORT_PW[0] && pk <= REAL_TRANSPORT_PW[1];
}

const SUN = GRAPHIC.gold;
const IR = GRAPHIC.red;

/** A vertical arrow from y1 to y2 (y2 is the tip), shaft width proportional to a flux. */
function Arrow({ x, y1, y2, w, color, opacity = 0.85 }: { x: number; y1: number; y2: number; w: number; color: string; opacity?: number }) {
  const width = Math.max(1.5, Math.min(64, w));
  const dir = y2 > y1 ? 1 : -1;
  const head = Math.min(14, Math.abs(y2 - y1) / 2);
  const hw = width / 2 + 6;
  const neck = y2 - dir * head;
  const pts = [
    [x - width / 2, y1],
    [x + width / 2, y1],
    [x + width / 2, neck],
    [x + hw, neck],
    [x, y2],
    [x - hw, neck],
    [x - width / 2, neck],
  ];
  return <polygon points={pts.map((p) => p.join(',')).join(' ')} fill={color} opacity={opacity} />;
}

/** Flux label beside an arrow. */
function Flux({ x, y, value, label, anchor = 'start', color }: { x: number; y: number; value: number; label: string; anchor?: 'start' | 'end'; color: string }) {
  return (
    <g>
      <text x={x} y={y} textAnchor={anchor} style={{ fontSize: 14, fontWeight: 600, fill: color }}>
        {fmt(value)} W/m²
      </text>
      <text x={x} y={y + 15} textAnchor={anchor} className="ax">
        {label}
      </text>
    </g>
  );
}

const PX_PER_WM2 = 0.1;

function PlanetDiagram({ p }: { p: PlanetInput }) {
  const b = planetBalance(p);
  const e = p.absorptivity;
  const surfC = b.surfaceK - K0;
  const atmo = { y: 118, h: 44 };
  const ground = 262;
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 310"
      role="img"
      aria-label={`Energy flows of a planet with sunlight ${fmt(p.solar)} W/m², albedo ${fmt(p.albedo, 2)} and an atmosphere absorbing ${fmt(e * 100)}% of the surface’s infrared. It absorbs ${fmt(b.absorbed)} W/m² of sunlight; the surface settles at ${fmt(b.surfaceK)} K (${fmt(surfC)} °C) and emits ${fmt(b.surfaceEmission)} W/m², of which ${fmt(b.windowFlux)} escape directly; the atmosphere sends ${fmt(b.backRadiation)} W/m² back down and the same up.`}
    >
      <text x={14} y={20} className="ax">
        Space
      </text>
      {/* Atmosphere layer: darker the more infrared it absorbs. */}
      <rect x={0} y={atmo.y} width={640} height={atmo.h} fill={tint('#7f9fb8', 0.15 + 0.45 * e)} />
      <text x={14} y={atmo.y + 18} className="lab">
        Atmosphere
      </text>
      <text x={14} y={atmo.y + 34} className="ax">
        {e > 0.001 ? `${fmt(b.atmosphereK)} K` : 'transparent'}
      </text>
      <rect x={0} y={ground} width={640} height={48} fill="#e7e1d3" />
      <text x={14} y={ground + 20} className="lab">
        Surface
      </text>
      <text x={14} y={ground + 37} style={{ fontSize: 14, fontWeight: 600, fill: TEXT.red }}>
        {fmt(b.surfaceK)} K · {fmt(surfC)} °C
      </text>

      {/* Sunlight in; the faint part is what's reflected. */}
      <Arrow x={140} y1={8} y2={ground} w={(b.absorbed + b.reflected) * PX_PER_WM2} color={SUN} opacity={0.35} />
      <Arrow x={140} y1={8} y2={ground} w={b.absorbed * PX_PER_WM2} color={SUN} />
      <Flux x={176} y={40} value={b.incoming} label="arriving" color={TEXT.gold} />
      <Flux x={176} y={226} value={b.absorbed} label="absorbed" color={TEXT.gold} />
      {b.reflected > 0.5 && <Arrow x={290} y1={ground - 4} y2={10} w={b.reflected * PX_PER_WM2} color={SUN} opacity={0.45} />}
      {b.reflected > 0.5 && <Flux x={322} y={76} value={b.reflected} label="reflected" color={TEXT.gold} />}

      {/* Infrared from the surface: part absorbed by the atmosphere, part through to space. */}
      <Arrow x={440} y1={ground} y2={e > 0.999 ? atmo.y + atmo.h : 10} w={b.surfaceEmission * PX_PER_WM2} color={IR} opacity={e > 0.999 ? 0.85 : 0.25} />
      {b.windowFlux > 0.5 && <Arrow x={440} y1={ground} y2={10} w={b.windowFlux * PX_PER_WM2} color={IR} />}
      <Flux x={482} y={226} value={b.surfaceEmission} label="from the surface" color={TEXT.red} />
      {b.windowFlux > 0.5 && <Flux x={482} y={40} value={b.windowFlux} label="escapes" color={TEXT.red} />}

      {/* The atmosphere's own emission, the same up and down. */}
      {e > 0.001 && (
        <g>
          <Arrow x={600} y1={atmo.y} y2={10} w={b.atmosphereUp * PX_PER_WM2} color={IR} opacity={0.6} />
          <Arrow x={600} y1={atmo.y + atmo.h} y2={ground} w={b.backRadiation * PX_PER_WM2} color={IR} opacity={0.6} />
          <Flux x={562} y={184} value={b.backRadiation} label="each way" anchor="end" color={TEXT.red} />
        </g>
      )}
    </svg>
  );
}

// The latitude chart: x is sin(latitude), so equal widths are equal areas of the planet.
const LX = scale(0, 1, 64, 616);
const sinD = (d: number) => Math.sin((d * Math.PI) / 180);
const LAT_TICKS = [0, 10, 20, 30, 40, 50, 60, 90];

function LatitudeChart({ d }: { d: number }) {
  const bal = useMemo(() => latitudeBalance(d), [d]);
  const bare = useMemo(() => latitudeBalance(0), []);
  const xs = bal.lat.map((l) => LX(sinD(l)));
  const fy = scale(40, 360, 150, 26);
  const ty = scale(-70, 70, 318, 196);
  // Surplus (absorbed above emitted) and deficit bands between the two curves.
  const band = (sign: 1 | -1) => {
    const top = bal.absorbed.map((a, i) => (sign > 0 ? Math.max(a, bal.olr[i]) : bal.olr[i]));
    const bot = bal.absorbed.map((a, i) => (sign > 0 ? bal.olr[i] : Math.min(a, bal.olr[i])));
    let path = '';
    for (let i = 0; i < xs.length; i++) path += (i ? ' L' : 'M') + xs[i].toFixed(1) + ' ' + fy(top[i]).toFixed(1);
    for (let i = xs.length - 1; i >= 0; i--) path += ' L' + xs[i].toFixed(1) + ' ' + fy(bot[i]).toFixed(1);
    return path + ' Z';
  };
  const surplus = band(1);
  const deficit = band(-1);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 344"
      role="img"
      aria-label={`Energy balance by latitude with a heat transport of ${fmt(d, 2)} W/m² per °C. ${d > 0 ? `Absorbed sunlight exceeds emitted infrared equatorward of ${fmt(bal.balanceLat)}° and falls short poleward of it.` : 'Every band emits exactly the sunlight it absorbs.'} The equator settles at ${fmt(bal.equatorC)} °C and the pole at ${fmt(bal.poleC)} °C; the most heat carried poleward is ${fmt(bal.peakTransportPW, 1)} petawatts, across ${fmt(bal.peakLat)}°.`}
    >
      <text className="ax" x={64} y={14}>
        Energy in and out, W/m²
      </text>
      <GridY y={fy} ticks={[100, 200, 300]} x0={64} x1={616} />
      <path d={surplus} fill={GRAPHIC.gold} opacity={0.25} />
      <path d={deficit} fill={GRAPHIC.blue} opacity={0.18} />
      <path d={linePath(xs, bal.absorbed.map(fy))} fill="none" stroke={GRAPHIC.gold} strokeWidth={2.5} />
      <path d={linePath(xs, bal.olr.map(fy))} fill="none" stroke={GRAPHIC.red} strokeWidth={2.5} />
      {d > 0 && bal.balanceLat < 89 && (
        <g>
          <line className="cur" x1={LX(sinD(bal.balanceLat))} x2={LX(sinD(bal.balanceLat))} y1={26} y2={150} />
          <text className="ax" x={LX(sinD(bal.balanceLat)) + 6} y={40}>
            balanced at {fmt(bal.balanceLat)}°
          </text>
        </g>
      )}
      <text className="ax" x={64} y={184}>
        Surface temperature, °C
      </text>
      <GridY y={ty} ticks={[-60, -30, 0, 30, 60]} x0={64} x1={616} baseline={0} />
      <path d={linePath(xs, bare.temp.map(ty))} fill="none" stroke="#9a9a9a" strokeWidth={1.5} strokeDasharray="5 4" />
      <path d={linePath(xs, bal.temp.map(ty))} fill="none" stroke={GRAPHIC.red} strokeWidth={3} />
      {LAT_TICKS.map((t) => (
        <text key={t} className="ax ax-m" x={LX(sinD(t))} y={336}>
          {t}°
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('planet', { solar: SOLAR_CONSTANT, albedo: EARTH_ALBEDO, absorptivity: 0 });
  const p = s.state;
  const b = planetBalance(p);
  const solved = greenhouseSolved(p);
  const surfC = b.surfaceK - K0;

  const l = useScenario('latitude', { transport: 0 });
  const d = l.state.transport;
  const bal = useMemo(() => latitudeBalance(d), [d]);
  const solved2 = transportSolved(d);
  const bare = planetBalance({ solar: SOLAR_CONSTANT, albedo: EARTH_ALBEDO, absorptivity: 0 });
  const noMove = latitudeBalance(0);

  return (
    <LessonPage id="weather/1.1">
      <P>
        A cold January in a port city costs its gas utility money and earns a gas producer some. By the end of this course we’ll price contracts that pay on exactly
        that kind of weather, and test whether a forecast can earn money trading them. But a contract on the weather is only as good as our understanding of what
        the weather will do, and that begins a long way from any market — with sunlight arriving at a spinning, partly cloudy planet.
      </P>
      <P>
        The atmosphere is a heat engine. It takes in <K tone={WX.energy}>energy</K> from the Sun, mostly where the Sun is high, and gives it back to space as
        infrared radiation, from everywhere. Everything we call weather — wind, storms, cold snaps and heat waves — is the atmosphere moving that energy from where
        it arrives to where it leaves. So we’ll start by balancing the books for the whole planet.
      </P>
      <P>
        Sunlight reaches Earth’s distance from the Sun at about 1,361 watts on every square meter facing it. A sphere presents only a disk to the Sun, and the disk
        has a quarter of the sphere’s area, so averaged over the whole planet, day and night, the arrival is a quarter of that: 340 W/m². Part of it is reflected
        straight back by clouds, ice and bright ground. That share is the <b>albedo</b>, about 0.30 for Earth today. The rest is absorbed and warms the surface,
        and a warm surface radiates infrared at a rate set by its <K tone={WX.temperature}>temperature</K> — σT⁴, the Stefan–Boltzmann law, with T in kelvins. The
        planet settles at the temperature where what it radiates equals what it absorbs.
      </P>
      <P>
        In the next demonstration, gold arrows are sunlight and red arrows are infrared, each drawn with a width proportional to its flux. It starts with an
        atmosphere that is transparent to infrared, so all of the surface’s radiation escapes straight to space. Change the sunlight, the albedo and how much of the
        surface’s infrared the atmosphere absorbs:
      </P>

      <Figure name="Planet Energy Model" scenario={s}>
        <PlanetDiagram p={p} />
        <Legend
          items={[
            { label: 'Sunlight', color: SUN },
            { label: 'Infrared', color: IR },
          ]}
        />
        <Readouts
          items={[
            { label: 'surface temperature', value: `${fmt(b.surfaceK)} K`, tone: WX.temperature },
            { label: 'in Celsius', value: `${fmt(surfC)} °C`, tone: WX.temperature },
            { label: 'sunlight absorbed', value: `${fmt(b.absorbed)} W/m²`, tone: WX.energy },
            { label: 'infrared leaving to space', value: `${fmt(b.olr)} W/m²`, tone: WX.temperature },
          ]}
        />
        <Slider label="Sunlight at the planet" tone={WX.energy} value={p.solar} min={500} max={2000} step={1} onChange={(v) => s.set({ solar: v })} display={`${fmt(p.solar)} W/m²`} />
        <Slider label="Albedo" value={p.albedo} min={0} max={0.9} step={0.01} onChange={(v) => s.set({ albedo: v })} display={fmt(p.albedo, 2)} />
        <Slider
          label="Infrared absorbed by the atmosphere"
          tone={WX.temperature}
          value={p.absorptivity}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => s.set({ absorptivity: v })}
          display={`${fmt(p.absorptivity * 100)}%`}
        />
        <Eq label="Temperature of a planet with no absorbing atmosphere">
          <span>
            T<Sub>e</Sub>
          </span>
          <Op>=</Op>
          <span>(</span>
          <Frac
            top={
              <>
                <K tone={WX.energy}>{fmt(p.solar)}</K> × (1 − {fmt(p.albedo, 2)})
              </>
            }
            bottom="4σ"
          />
          <span>
            )<Sup>¼</Sup>
          </span>
          <Op>=</Op>
          <K tone={WX.temperature}>{fmt(b.effectiveK)} K</K>
        </Eq>
      </Figure>

      <P>
        With today’s sunlight and albedo and no absorbing atmosphere, the planet settles at {fmt(bare.surfaceK)} K, or {fmt(bare.surfaceK - K0)} °C. Absorbed sunlight
        and emitted infrared balance at {fmt(bare.absorbed)} W/m², but the surface is frozen. That temperature, the one a bare planet would have, is called the{' '}
        <b>effective temperature</b>. The equation in the demonstration computes it, and it depends only on the sunlight and the albedo. It is a good description
        of an airless world. Set the sunlight to about 590 W/m² and the albedo to 0.25, roughly what Mars receives and reflects, and it gives 210 K — close to the
        average temperature measured on Mars, whose thin atmosphere does little.
      </P>
      <P>
        Earth’s surface averages about 288 K, or 15 °C, some 33 degrees warmer than its effective temperature. The difference is the <b>greenhouse effect</b>. Water
        vapor, carbon dioxide and a few other gases let most sunlight through but absorb much of the infrared the surface emits. Whatever they absorb they re-emit,
        in every direction — half of it, in this simple model, back down. The surface is now warmed by the Sun and by the atmosphere above it, so it must reach a
        higher temperature before the infrared that finally escapes to space matches the sunlight coming in.
      </P>

      <Challenge
        id="a"
        question="With today’s sunlight (1,361 W/m²) and albedo (0.30), how much of the surface’s infrared must the atmosphere absorb to give Earth’s observed average surface temperature of 288 K?"
        solved={solved}
        status={
          p.solar !== SOLAR_CONSTANT || Math.abs(p.albedo - EARTH_ALBEDO) > 1e-9
            ? 'First set the sunlight back to 1,361 W/m² and the albedo to 0.30.'
            : `Right now the surface settles at ${fmt(b.surfaceK, 1)} K.`
        }
        success={`Solved. At ${fmt(p.absorptivity * 100)}%, the surface emits ${fmt(b.surfaceEmission)} W/m², the atmosphere returns ${fmt(b.backRadiation)} W/m² of it, and the ${fmt(b.olr)} W/m² that leaves the top matches the sunlight absorbed. Notice that the balance at the top doesn’t depend on the atmosphere at all: what changes is how warm the surface must be to push that much infrared out.`}
      />

      <P>
        One layer that absorbs {fmt(EARTH_ABSORPTIVITY * 100)}% of the surface’s infrared is a crude picture of a real atmosphere, which is many layers deep and warm
        near the ground, and which also carries heat up from the surface by rising air and evaporated water. But the model gets the essential point right. The
        surface temperature rises until the planet sheds as much energy as it absorbs, and anything that changes the absorbed sunlight or the escaping infrared moves
        that balance. In this model, raising the albedo by just 0.01 — one more percent of sunlight reflected — cools the surface by about a kelvin.
      </P>

      <H2>Too much at the equator, too little at the poles</H2>
      <P>
        A single average hides the fact that drives all weather. Sunlight strikes the tropics nearly head-on and the poles at a glancing angle, spread over far more
        ground. Snow and ice make the high latitudes brighter still. But infrared leaves from everywhere, warm or cold. So the tropics absorb more than they emit and
        the high latitudes emit more than they absorb.
      </P>
      <P>
        The next demonstration is a planet built from bands of latitude, each balancing sunlight against infrared, with today’s albedo pattern. Its horizontal axis
        runs from the equator to the pole, stretched so that equal widths are equal areas of the planet’s surface. The upper chart compares the sunlight each band
        absorbs, in gold, with the infrared it emits, in red; the lower one shows the temperature each band settles at, with the dashed line the temperature it would
        have if nothing moved between bands. The slider sets how easily heat flows from warm bands to cold ones — a stand-in for the winds and ocean currents that
        carry it. It starts at zero:
      </P>

      <Figure name="Planet Energy Model · by latitude" scenario={l}>
        <LatitudeChart d={d} />
        <Legend
          items={[
            { label: 'Sunlight absorbed', color: GRAPHIC.gold, kind: 'line' },
            { label: 'Infrared emitted', color: GRAPHIC.red, kind: 'line' },
            { label: 'Surplus', color: tint(GRAPHIC.gold, 0.4) },
            { label: 'Deficit', color: tint(GRAPHIC.blue, 0.3) },
            { label: 'Without transport', color: '#9a9a9a', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'at the equator', value: `${fmt(bal.equatorC)} °C`, tone: WX.temperature },
            { label: 'at the pole', value: `${fmt(bal.poleC)} °C`, tone: WX.temperature },
            { label: 'most heat carried poleward', value: `${fmt(bal.peakTransportPW, 1)} PW`, tone: WX.energy },
          ]}
        />
        <Slider
          label="Heat transport between latitudes"
          tone={WX.energy}
          value={d}
          min={0}
          max={1.5}
          step={0.05}
          onChange={(v) => l.set({ transport: v })}
          display={`${fmt(d, 2)} W/m² per °C`}
        />
      </Figure>

      <P>
        With no transport, every band balances on its own. The equator reaches {fmt(noMove.equatorC)} °C and the pole {fmt(noMove.poleC)} °C, and the latitude of
        this course’s fictional city, Calder Bay, at 41° north, averages a little below freezing. The gold and red curves lie on top of each other, because each band emits
        exactly what it absorbs.
      </P>
      <P>
        Now let heat flow. The bands near the equator emit less than they absorb and the high latitudes emit more, and the shaded surplus and deficit appear between
        the curves. Because the axis is stretched to equal areas, the gold area always equals the blue one: the planet as a whole still balances, and its average
        temperature stays at 15 °C whatever the slider says. What changes is the shape. The tropics cool and the poles warm; at 0.6 W/m² per °C, 41° north
        climbs to about {fmt(tempAtLatitude(latitudeBalance(0.6), 41))} °C. The heat crossing each latitude circle is measured in petawatts, millions of billions of watts. It peaks
        near 33°, the latitude where surplus turns to deficit, because everything absorbed in excess on the equator’s side of that line must cross it.
      </P>

      <Challenge
        id="b"
        question="Estimates for the real Earth put the peak poleward heat transport, by atmosphere and ocean together, at about 5–6 petawatts. Set the transport so the model carries that much."
        solved={solved2}
        status={`Right now the most heat carried poleward is ${fmt(bal.peakTransportPW, 1)} PW.`}
        success={`Solved. At ${fmt(bal.peakTransportPW, 1)} PW the equator settles at ${fmt(bal.equatorC)} °C and the pole at ${fmt(bal.poleC)} °C — the real equator averages about 27 °C. The temperature difference between them is what keeps the transport going: heat flows only because the tropics stay warmer than the poles.`}
      />

      <P>
        Of the two carriers, the atmosphere does most of the work in the middle latitudes, and it doesn’t do it smoothly. There’s no slow, steady conveyor of warm
        air toward the poles. Instead, the contrast between warm and cold air builds up until it breaks down into swirling storms that mix the two — the cold fronts,
        snowstorms and mild spells of a winter at 41°. In <FigRef to="Planet Energy Model · by latitude">the latitude demonstration</FigRef>, a single slider
        stands in for all of that. The rest of this chapter takes it apart.
      </P>
      <P>
        We’ll start with the smallest piece of the machine: a single parcel of air, and what happens to its temperature, pressure and density when it is heated,
        cooled, squeezed or allowed to expand. That is the subject of the next lesson.
      </P>
    </LessonPage>
  );
}
