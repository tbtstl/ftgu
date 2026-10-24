import { useId, useMemo } from 'react';
import { Caption, Challenge, Eq, FigRef, Figure, Frac, H2, K, Legend, LessonPage, Op, P, Readouts, Slider, Sub, fmt, lessonHref, useScenario } from '../../../framework';
import { BBL_PER_ACRE_FT, domeK, hydrostatic, naturalFlowMargin, trapVolume } from '../../../engines/oil/reservoir';
import { BRINE_GRADIENT, FIELDS, NORTHFIELD_TRAP, gradient } from '../../../model/oil/fields';

const NF = FIELDS.northfield;
const RB = FIELDS.ridgeback;
const CREST = NF.crestDepth;
const SPILL = NORTHFIELD_TRAP.spillDepth;
const K_DOME = domeK(CREST, SPILL, NORTHFIELD_TRAP.spillRadius);
/** Wellhead pressure the oil must overcome to enter the flowline, psi (as in naturalFlowMargin). */
const WELLHEAD = 100;
const OIL_GRAD = gradient(NF.reservoirOilSG);

/** The discovery well's contact and the oil it implies at the field's porosity and water saturation. */
export const DISCOVERY_OWC = NORTHFIELD_TRAP.oilWaterContact;
export const BASE_OIL = trapVolume(NF, DISCOVERY_OWC).oil;
export const OWC_STEP = 5;
export const PRESSURE_STEP = 10;

/** Challenge a: the shallowest contact (on the slider's 5 ft steps) that doubles the oil, at 22% porosity and 25% water. */
export function doubleSolved(owc: number, porosityPct: number, swPct: number): boolean {
  if (porosityPct !== Math.round(NF.porosity * 100) || swPct !== Math.round(NF.waterSaturation * 100)) return false;
  const oil = (d: number) => trapVolume(NF, d).oil;
  return oil(owc) >= 2 * BASE_OIL && oil(owc - OWC_STEP) < 2 * BASE_OIL;
}

/** Pressure at the crest a well full of Northfield oil needs to reach the surface, psi. */
export const FLOW_NEEDS = gradient(NF.reservoirOilSG) * CREST + WELLHEAD;

/** Challenge b: the lowest crest pressure (on the slider's 10 psi steps) at which a well still flows on its own. */
export function flowStopSolved(p: number): boolean {
  const m = (x: number) => naturalFlowMargin(x, CREST, NF.reservoirOilSG, WELLHEAD);
  return m(p) >= 0 && m(p - PRESSURE_STEP) < 0;
}

function mstb(bbl: number): string {
  return `${fmt(bbl / 1e6)} million`;
}

// ---------------------------------------------------------------------------
// The cross-section.

const SX0 = 70;
const SX1 = 610;
const XMAX = 16500; // ft either side of the crest
const D_TOP = 7640;
const D_BOT = 8480;
const SY0 = 30;
const SY1 = 272;
const sx = (x: number) => SX0 + ((x + XMAX) / (2 * XMAX)) * (SX1 - SX0);
const sy = (d: number) => SY0 + ((d - D_TOP) / (D_BOT - D_TOP)) * (SY1 - SY0);
const top = (x: number) => CREST + K_DOME * x * x;
const SEAL = 70; // ft of shale drawn over the reservoir
const XS = Array.from({ length: 121 }, (_, i) => -XMAX + (i / 120) * 2 * XMAX);

function band(upper: (x: number) => number, lower: (x: number) => number, xs = XS): string {
  const a = xs.map((x) => `${sx(x).toFixed(1)} ${sy(upper(x)).toFixed(1)}`);
  const b = [...xs].reverse().map((x) => `${sx(x).toFixed(1)} ${sy(lower(x)).toFixed(1)}`);
  return `M${a.join(' L')} L${b.join(' L')} Z`;
}

const OIL_FILL = '#8a5a24';
const WATER_FILL = '#c9def0';

function CrossSection({ owc, porosity, sw }: { owc: number; porosity: number; sw: number }) {
  const H = NF.grossThickness;
  const reach = Math.sqrt(Math.max(0, owc - CREST) / K_DOME);
  const oilXs = reach > 0 ? Array.from({ length: 81 }, (_, i) => -reach + (i / 80) * 2 * reach) : [];
  const spillX = NORTHFIELD_TRAP.spillRadius;
  const vol = trapVolume(NF, owc, { porosity, sw });
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 300"
      role="img"
      aria-label={`Cross-section of the Northfield dome: a ${H}-foot sandstone under a shale seal, its crest at ${fmt(CREST)} ft. Oil fills the top of the dome down to a contact at ${fmt(owc)} ft, a ${fmt(vol.column)}-foot column; water fills the rock beneath. The trap spills at ${fmt(SPILL)} ft. Inset: sand grains with ${fmt(porosity * 100)}% pore space, ${fmt(sw * 100)}% of it water.`}
    >
      <rect x={SX0} y={SY0} width={SX1 - SX0} height={SY1 - SY0} fill="#f3efe5" />
      <path d={band((x) => top(x) + H, () => D_BOT)} fill="#e4ddcd" />
      <path d={band((x) => top(x) - SEAL, (x) => top(x))} fill="#a9a399" />
      <path d={band((x) => top(x), (x) => top(x) + H)} fill={WATER_FILL} />
      {oilXs.length > 1 && <path d={band((x) => top(x), (x) => Math.min(top(x) + H, owc), oilXs)} fill={OIL_FILL} opacity={0.85} />}
      <path d={band((x) => top(x), (x) => top(x) + H)} fill="none" stroke="#7d7466" strokeWidth={1} />
      {/* Oil–water contact */}
      {reach > 0 && <line x1={sx(-reach)} x2={sx(reach)} y1={sy(owc)} y2={sy(owc)} stroke="#2f6fb3" strokeWidth={1.5} strokeDasharray="5 3" />}
      {/* Spill point */}
      <line x1={sx(-XMAX)} x2={sx(XMAX)} y1={sy(SPILL)} y2={sy(SPILL)} stroke="#777" strokeWidth={1} strokeDasharray="2 4" />
      <circle cx={sx(spillX)} cy={sy(SPILL)} r={4} fill="#333" />
      <circle cx={sx(-spillX)} cy={sy(SPILL)} r={4} fill="#333" />
      <text className="ax" x={sx(-spillX) + 8} y={sy(SPILL) - 6}>
        spill point, {fmt(SPILL)} ft
      </text>
      {/* Labels */}
      <text x={sx(0)} y={sy(CREST - SEAL) - 8} textAnchor="middle" style={{ fontSize: 12, fill: '#5f5f5f' }}>
        shale seal
      </text>
      {vol.column > 30 && (
        <text x={sx(0)} y={sy(CREST + Math.min(H, vol.column) / 2) + 4} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: '#fff' }}>
          oil
        </text>
      )}
      <text x={sx(-11200)} y={sy(top(-11200) + H / 2) + 4} textAnchor="middle" style={{ fontSize: 12, fill: '#2f6fb3' }}>
        water
      </text>
      <text x={sx(-2500)} y={sy(top(-2500) + H) + 16} textAnchor="middle" style={{ fontSize: 11.5, fill: '#5f5f5f' }}>
        sandstone, {H} ft thick
      </text>
      {reach > 0 && (
        <text x={sx(reach) + 6} y={sy(owc) + 4} style={{ fontSize: 11.5, fill: '#2f6fb3', fontWeight: 500 }}>
          contact {fmt(owc)} ft
        </text>
      )}
      {[7800, 8000, 8200, 8400].map((d) => (
        <g key={d}>
          <line x1={SX0 - 4} x2={SX0} y1={sy(d)} y2={sy(d)} stroke="#999" />
          <text className="ax ax-e" x={SX0 - 7} y={sy(d) + 4}>
            {fmt(d)}
          </text>
        </g>
      ))}
      <text className="ax" x={SX0} y={18}>
        Depth, ft · about 6 miles across, vertical scale exaggerated
      </text>
      <PoreInset x={500} y={34} size={100} porosity={porosity} sw={sw} />
    </svg>
  );
}

/** A square of sand grains: pore space set by porosity, a water film around each grain set by Sw, oil in the rest. */
function PoreInset({ x, y, size, porosity, sw }: { x: number; y: number; size: number; porosity: number; sw: number }) {
  const n = 4;
  const c = size / n;
  const r = c * Math.sqrt((1 - porosity) / Math.PI);
  const rh = Math.sqrt(r * r + (sw * porosity * c * c) / Math.PI);
  const grains: Array<[number, number]> = [];
  for (let i = -1; i <= n; i++) for (let j = -1; j <= n; j++) grains.push([x + (i + 0.5) * c + (j % 2 ? c / 2 : 0), y + (j + 0.5) * c]);
  const clip = 'pore' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={x} y={y} width={size} height={size} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x={x} y={y} width={size} height={size} fill={OIL_FILL} />
        {grains.map(([gx, gy], i) => (
          <circle key={'w' + i} cx={gx} cy={gy} r={rh} fill="#7fb2dc" />
        ))}
        {grains.map(([gx, gy], i) => (
          <circle key={'g' + i} cx={gx} cy={gy} r={r} fill="#e8d9b0" stroke="#c9b98c" strokeWidth={0.8} />
        ))}
      </g>
      <rect x={x} y={y} width={size} height={size} fill="none" stroke="#555" strokeWidth={1} />
      <text className="ax ax-m" x={x + size / 2} y={y + size + 14}>
        pores, magnified
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Pressure against depth.

const PX0 = 76;
const PX1 = 610;
const PY0 = 30;
const PY1 = 288;
const P_MAX = 6000;
const Z_MAX = 10000;
const px = (p: number) => PX0 + (p / P_MAX) * (PX1 - PX0);
const pz = (z: number) => PY0 + (z / Z_MAX) * (PY1 - PY0);

function PressureChart({ p }: { p: number }) {
  const margin = naturalFlowMargin(p, CREST, NF.reservoirOilSG, WELLHEAD);
  const ok = margin >= 0;
  const owc = DISCOVERY_OWC;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 312"
      role="img"
      aria-label={`Pressure against depth. Normal brine pressure rises 0.465 psi per foot, ${fmt(hydrostatic(CREST))} psi at Northfield’s crest. The reservoir is at ${fmt(p)} psi; a well full of oil needs ${fmt(FLOW_NEEDS)} psi there, so ${ok ? `it flows with ${fmt(margin)} psi to spare` : `it falls ${fmt(-margin)} psi short and cannot flow on its own`}. Ridgeback, at ${fmt(RB.crestDepth)} ft, is at ${fmt(RB.initialPressure)} psi.`}
    >
      <text className="ax" x={PX0} y={14}>
        Depth, ft (down) · pressure, psi (across)
      </text>
      {[0, 2000, 4000, 6000, 8000, 10000].map((z) => (
        <g key={'z' + z}>
          <line className={z === 0 ? 'base' : 'gl'} x1={PX0} x2={PX1} y1={pz(z)} y2={pz(z)} />
          <text className="ax ax-e" x={PX0 - 6} y={pz(z) + 4}>
            {fmt(z)}
          </text>
        </g>
      ))}
      {[0, 1000, 2000, 3000, 4000, 5000, 6000].map((v) => (
        <g key={'p' + v}>
          <line className={v === 0 ? 'base' : 'gl'} x1={px(v)} x2={px(v)} y1={PY0} y2={PY1} />
          <text className="ax ax-m" x={px(v)} y={PY1 + 16}>
            {fmt(v)}
          </text>
        </g>
      ))}
      {/* Normal (hydrostatic) pressure */}
      <line x1={px(0)} y1={pz(0)} x2={px(BRINE_GRADIENT * Z_MAX)} y2={pz(Z_MAX)} stroke="#9a9a9a" strokeWidth={2} strokeDasharray="6 4" />
      <text x={px(BRINE_GRADIENT * 3000) + 8} y={pz(3000)} style={{ fontSize: 11.5, fill: '#5f5f5f' }}>
        normal pressure: brine, {BRINE_GRADIENT} psi/ft
      </text>
      {/* A well full of oil */}
      <line x1={px(WELLHEAD)} y1={pz(0)} x2={px(FLOW_NEEDS)} y2={pz(CREST)} stroke="#d0702a" strokeWidth={2.5} />
      <text x={px(BRINE_GRADIENT * 1200) + 12} y={pz(1200)} style={{ fontSize: 11.5, fill: '#ad5310' }}>
        a well full of oil, {fmt(OIL_GRAD, 3)} psi/ft
      </text>
      {/* The reservoir's oil column at the current pressure */}
      <line x1={px(p)} y1={pz(CREST)} x2={px(p + OIL_GRAD * (owc - CREST))} y2={pz(owc)} stroke="#2f6fb3" strokeWidth={4} />
      {/* Margin */}
      <line x1={px(FLOW_NEEDS)} x2={px(p)} y1={pz(CREST) - 14} y2={pz(CREST) - 14} stroke={ok ? '#3f7a1e' : '#c4382f'} strokeWidth={2} />
      <line x1={px(FLOW_NEEDS)} x2={px(FLOW_NEEDS)} y1={pz(CREST) - 20} y2={pz(CREST) - 8} stroke={ok ? '#3f7a1e' : '#c4382f'} strokeWidth={2} />
      <line x1={px(p)} x2={px(p)} y1={pz(CREST) - 20} y2={pz(CREST) - 8} stroke={ok ? '#3f7a1e' : '#c4382f'} strokeWidth={2} />
      <text x={(px(p) + px(FLOW_NEEDS)) / 2} y={pz(CREST) - 26} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: ok ? '#3f7a1e' : '#c4382f' }}>
        {ok ? `+${fmt(margin)} psi` : `−${fmt(-margin)} psi`}
      </text>
      <circle cx={px(FLOW_NEEDS)} cy={pz(CREST)} r={5} fill="#d0702a" stroke="#fff" strokeWidth={1.5} />
      <circle cx={px(p)} cy={pz(CREST)} r={6.5} fill="#2f6fb3" stroke="#fff" strokeWidth={1.5} />
      <text x={px(p) + 10} y={pz(CREST) + 16} style={{ fontSize: 12, fontWeight: 500, fill: '#2f6fb3' }}>
        Northfield, {fmt(p)} psi
      </text>
      {/* Ridgeback, overpressured */}
      <line x1={px(hydrostatic(RB.crestDepth))} x2={px(RB.initialPressure)} y1={pz(RB.crestDepth)} y2={pz(RB.crestDepth)} stroke="#777" strokeWidth={1} strokeDasharray="3 3" />
      <circle cx={px(RB.initialPressure)} cy={pz(RB.crestDepth)} r={5.5} fill="#6b5a4e" stroke="#fff" strokeWidth={1.5} />
      <text x={px(hydrostatic(RB.crestDepth)) - 10} y={pz(RB.crestDepth) + 4} textAnchor="end" style={{ fontSize: 12, fill: '#333' }}>
        Ridgeback shale, overpressured: {fmt(RB.initialPressure)} psi
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s1 = useScenario('trap', { owc: DISCOVERY_OWC, porosity: Math.round(NF.porosity * 100), sw: Math.round(NF.waterSaturation * 100) });
  const { owc } = s1.state;
  const phi = s1.state.porosity / 100;
  const sw = s1.state.sw / 100;
  const vol = trapVolume(NF, owc, { porosity: phi, sw });
  const base = trapVolume(NF, DISCOVERY_OWC);
  const full = trapVolume(NF, SPILL);
  const doubled = useMemo(() => {
    for (let d = CREST; d <= SPILL; d += OWC_STEP) if (doubleSolved(d, Math.round(NF.porosity * 100), Math.round(NF.waterSaturation * 100))) return trapVolume(NF, d);
    return full;
  }, [full]);
  const defaultsKept = s1.state.porosity === Math.round(NF.porosity * 100) && s1.state.sw === Math.round(NF.waterSaturation * 100);
  const solvedA = doubleSolved(owc, s1.state.porosity, s1.state.sw);

  const s2 = useScenario('pressure', { p: NF.initialPressure });
  const p = s2.state.p;
  const margin = naturalFlowMargin(p, CREST, NF.reservoirOilSG, WELLHEAD);
  const solvedB = flowStopSolved(p);
  const crestStart = naturalFlowMargin(NF.initialPressure, CREST, NF.reservoirOilSG, WELLHEAD);
  const rbNormal = hydrostatic(RB.crestDepth);

  return (
    <LessonPage id="oil/2.1">
      <P>
        Chapter 1 followed crude oil from its molecules to the fuels made from them. None of that matters until the oil has been found and brought to the surface, so
        this chapter goes underground. The picture many people carry — a lake of oil in a cavern — is wrong. Oil underground sits in rock, in the tiny spaces between
        grains of sand or in the cavities of old reefs, the way water sits in a sponge. Getting it out is a matter of persuading it to flow through those spaces to a well.
      </P>
      <P>
        Most oil began as the remains of microscopic marine life — algae and plankton — that settled into fine mud on the floors of ancient seas. Buried under more
        sediment for millions of years, the mud became a <b>source rock</b>, and the rising heat of burial slowly broke its organic matter into oil and gas. Being lighter
        than the water that fills the pores of buried rock, the oil crept upward, through any rock porous enough to let it pass. Much of it reached the surface and was
        lost. What we find is the fraction that met a <b>seal</b> — a layer of rock too tight to pass through, usually shale or salt — shaped so the oil couldn’t slip
        around it. That arrangement is a <b>trap</b>. The rock bowed up into a dome, an <b>anticline</b>, is the classic one; a fault that slides a seal against a
        porous layer, or a porous layer that thins out into shale, works too.
      </P>
      <P>
        Northfield, the field that produces Northfield Sour, is a dome. Its top, the crest, lies at {fmt(CREST)} ft, and the porous sandstone under its shale seal is{' '}
        {NF.grossThickness} ft thick, about half of it good-quality rock. In the next demonstration, move the contact between oil and water, and change the rock’s
        porosity and water saturation:
      </P>

      <Figure name="Oil Reservoir Explorer" scenario={s1}>
        <Legend
          items={[
            { label: 'Oil', color: OIL_FILL },
            { label: 'Water', color: WATER_FILL },
            { label: 'Shale seal', color: '#a9a399' },
          ]}
        />
        <CrossSection owc={owc} porosity={phi} sw={sw} />
        <Readouts
          items={[
            { label: 'oil column', value: `${fmt(vol.column)} ft` },
            { label: 'area inside the contact', value: `${fmt(vol.areaAcres)} acres` },
            { label: 'oil in place', value: `${mstb(vol.oil)} STB` },
          ]}
        />
        <Slider label="Oil–water contact" value={owc} min={CREST} max={SPILL} step={OWC_STEP} onChange={(v) => s1.set({ owc: v })} display={`${fmt(owc)} ft`} />
        <Slider label="Porosity" value={s1.state.porosity} min={5} max={35} onChange={(v) => s1.set({ porosity: v })} display={`${s1.state.porosity}%`} />
        <Slider label="Water saturation" tone="blue" value={s1.state.sw} min={10} max={60} onChange={(v) => s1.set({ sw: v })} display={`${s1.state.sw}%`} />
        <Eq
          label={`Oil in place: 7,758 times ${fmt(vol.netAcreFt)} acre-feet times ${fmt(phi, 2)} times ${fmt(1 - sw, 2)} divided by ${NF.bo} equals ${mstb(vol.oil)} stock-tank barrels`}
        >
          <span>N</span>
          <Op>=</Op>
          <Frac
            top={
              <>
                {fmt(BBL_PER_ACRE_FT)} × {fmt(vol.netAcreFt)} × {fmt(phi, 2)} × (1 − {fmt(sw, 2)})
              </>
            }
            bottom={<>{NF.bo}</>}
          />
          <Op>=</Op>
          <span>{mstb(vol.oil)} STB</span>
        </Eq>
        <Caption>
          {vol.column === 0
            ? 'With the contact at the crest, the trap holds no oil.'
            : `${fmt(vol.netAcreFt)} acre-feet of good rock lie above the contact. ${owc >= SPILL ? 'The trap is full: any more oil would spill out at the edge of the dome and keep migrating.' : ''}`}
        </Caption>
      </Figure>

      <P>
        Rock is mostly rock. The <b>porosity</b> is the share of it that is empty space, and in reservoir rocks it typically runs from about 5% to 30%; Northfield’s
        sandstone is {fmt(NF.porosity * 100)}%. Nor is that space all oil. The rock was full of water before the oil arrived, and the oil never pushed all of it out:
        a film of water still clings to every grain, as the magnified pores show. The share of the pore space holding water is the <b>water saturation</b>, and at
        Northfield it is {fmt(NF.waterSaturation * 100)}%.
      </P>
      <P>
        Inside the trap, the fluids are stacked by density, like oil on water in a glass. If there is enough gas, it forms a cap at the top; then comes oil; and below
        the <b>oil–water contact</b>, the rock holds only water. Northfield’s discovery well found the contact at {fmt(DISCOVERY_OWC)} ft, so the oil column is{' '}
        {fmt(base.column)} ft tall and covers {fmt(base.areaAcres)} acres. A trap can’t hold oil deeper than its <b>spill point</b>, where the dome’s closure ends:
        filled to {fmt(SPILL)} ft, Northfield would hold {mstb(full.oil)} barrels.
      </P>
      <P>
        Counting the oil takes the industry’s standard volumetric equation. An acre-foot — an acre of ground one foot thick — holds{' '}
        {fmt(BBL_PER_ACRE_FT)} barrels, so the oil is 7,758 × A × h × φ × (1 − S<Sub>w</Sub>), where A × h is the volume of good rock above the contact, here worked out
        for the curved shape of the dome. One more factor matters. Underground, the oil holds gas dissolved under pressure; brought to the surface, the gas bubbles out
        and the oil shrinks. The <b>formation volume factor</b>, B<Sub>o</Sub>, is the shrinkage: {NF.bo} barrels in the reservoir become one <b>stock-tank barrel</b>{' '}
        (STB) at the surface. At the discovery well’s contact, Northfield holds {mstb(BASE_OIL)} stock-tank barrels.
      </P>

      <Challenge
        id="a"
        question="Geologists aren’t sure where the contact lies away from the discovery well. With porosity at 22% and water saturation at 25%, how deep would the contact have to be for Northfield to hold twice as much oil, to the nearest 5 feet?"
        solved={solvedA}
        status={
          defaultsKept
            ? `With the contact at ${fmt(owc)} ft, Northfield holds ${mstb(vol.oil)} STB, ${fmt(vol.oil / BASE_OIL, 2)} times the ${mstb(BASE_OIL)} at ${fmt(DISCOVERY_OWC)} ft.`
            : 'Set porosity back to 22% and water saturation to 25% first.'
        }
        success={`Solved: ${fmt(owc)} ft. A column of ${fmt(doubled.column)} ft, ${fmt((doubled.column / base.column - 1) * 100)}% taller, holds twice the oil, because the dome widens with depth: the contact now encloses ${fmt(doubled.areaAcres)} acres instead of ${fmt(base.areaAcres)}. Where a contact lies is one of the biggest uncertainties when a field is discovered.`}
      />

      <H2>Pressure</H2>
      <P>
        Oil in place isn’t oil at the surface. What pushes it up a well is <K tone="blue">pressure</K>. The water in the pores of buried rock is usually connected, through
        the pores, all the way up toward the surface, so its pressure is simply the weight of the water above it. Fresh water adds 0.433 psi of pressure for every foot
        of depth, and the salty water, or brine, in most rocks about {BRINE_GRADIENT}: at Northfield’s contact, {fmt(hydrostatic(DISCOVERY_OWC))} psi. Oil is lighter
        than brine, so in the oil column the pressure falls more slowly toward the crest, and the crest sits at about {fmt(NF.initialPressure)} psi.
      </P>
      <P>
        A well is a hole from the crest to the surface. Once it fills with oil, the oil in it weighs on the bottom of the well, and the reservoir must push harder than
        that weight, plus a little more to drive the oil into the pipes at the surface, for the well to flow by itself. The next demonstration plots pressure against
        depth. The dashed line is normal pressure; the orange line is what a well full of Northfield oil needs at each depth. Lower the reservoir’s pressure, as years of
        production will:
      </P>

      <Figure name="Oil Reservoir Explorer · pressure" scenario={s2}>
        <PressureChart p={p} />
        <Readouts
          items={[
            { label: <K tone="blue">pressure at the crest</K>, value: `${fmt(p)} psi`, tone: 'blue' },
            { label: 'a full well needs', value: `${fmt(FLOW_NEEDS)} psi` },
            { label: margin >= 0 ? 'to spare' : 'short by', value: `${fmt(Math.abs(margin))} psi`, tone: margin >= 0 ? 'green' : 'red' },
          ]}
        />
        <Slider label="Reservoir pressure" tone="blue" value={p} min={1500} max={NF.initialPressure} step={PRESSURE_STEP} onChange={(v) => s2.set({ p: v })} display={`${fmt(p)} psi`} />
        <Caption>
          {margin >= 0
            ? `The well flows on its own, with ${fmt(margin)} psi more than it needs to lift its oil.`
            : `The reservoir can’t lift a full column of oil to the surface. Without a pump, the well stops flowing.`}
        </Caption>
      </Figure>

      <P>
        A column of Northfield oil {fmt(CREST)} ft tall presses down with {fmt(FLOW_NEEDS - WELLHEAD)} psi; add {WELLHEAD} psi at the wellhead and the well needs{' '}
        {fmt(FLOW_NEEDS)} psi at the bottom. When the field was discovered, it had {fmt(crestStart)} psi to spare, and its wells flowed on their own. But every barrel
        produced lets the pressure fall. This is a simple picture — in a real well, gas bubbling out of the oil lightens the column and helps it rise — but the
        conclusion holds: sooner or later a field’s natural flow stops, and the wells need pumps, called <b>artificial lift</b>. Often the operator also injects water to
        hold the pressure up. Both come back in <a href={lessonHref('oil/2.4')}>Lesson 2.4</a>.
      </P>

      <Challenge
        id="b"
        question="Find the lowest reservoir pressure, to the nearest 10 psi, at which a Northfield well still flows to the surface on its own."
        solved={solvedB}
        status={
          margin >= 0
            ? `At ${fmt(p)} psi the well still flows, with ${fmt(margin)} psi to spare.`
            : `At ${fmt(p)} psi the well is ${fmt(-margin)} psi short.`
        }
        success={`Solved: ${fmt(p)} psi. The well needs ${fmt(FLOW_NEEDS)} psi, so anything lower and the column of oil in it is too heavy to push out. Northfield started with about ${fmt(crestStart)} psi more than that; as the field is produced, that margin is used up.`}
      />

      <H2>Rock that never let its oil go</H2>
      <P>
        Not every reservoir is normally pressured. Where rock was buried faster than its water could escape, the pores carry part of the weight of the rock above, and
        the pressure runs high. The Ridgeback shale, the other rock in our basin, is like that: at {fmt(RB.crestDepth)} ft it holds {fmt(RB.initialPressure)} psi, about{' '}
        {fmt(RB.initialPressure / RB.crestDepth, 1)} psi per foot, against the {fmt(rbNormal)} psi a column of brine would give.
      </P>
      <P>
        Ridgeback differs in a more important way, too. It is a source rock: the oil that was cooked out of it never left. The shale’s pores are so small and so poorly
        connected that the oil could hardly move, which is exactly why it’s still there — and why, for most of the industry’s history, nobody could produce it.
        Northfield’s sandstone passes oil readily; Ridgeback’s shale barely passes it at all. How readily rock lets oil through, and what that means for a well, is the
        subject of the <a href={lessonHref('oil/2.2')}>next lesson</a>. You can return to <FigRef to="Oil Reservoir Explorer">the first demonstration</FigRef> to see how
        much oil each foot of contact adds.
      </P>
    </LessonPage>
  );
}
