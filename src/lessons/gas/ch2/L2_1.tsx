import {
  Challenge,
  DataTable,
  Eq,
  FigRef,
  Figure,
  Frac,
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
  Sup,
  TEXT,
  Tn,
  clamp,
  fmt,
  lessonHref,
  pct,
  tint,
  useScenario,
} from '../../../framework';
import { zFactor } from '../../../engines/gas/eos';
import { rankine } from '../../../engines/gas/properties';
import {
  LINEAR_FLOW_CONSTANT,
  WELLBORE_RADIUS_FT,
  drainageRadius,
  fractureFaceArea,
  fractureFlowDistance,
  fracturedWellRate,
  gasFVF,
  gasInPlace,
  gasViscosity,
  wellRate,
  type FracturedWell,
  type Rock,
} from '../../../engines/gas/reservoir';
import { PIPELINE } from '../../../model/gas/world';
import { RIDGEBACK_FRACS, RIDGEBACK_PI, RIDGEBACK_ROCK, SANDHILL_PI, SANDHILL_P_NOW, SANDHILL_ROCK } from '../../../model/gas/production';

// ---------------------------------------------------------------------------
// The first demonstration: one square mile of rock, 50 ft thick, at 180 °F.

/** Fixed properties of the first demonstration's rock. */
export const BASE_ROCK: Rock = { areaAcres: 640, thicknessFt: 50, porosity: 0.15, waterSat: 0.3, permMd: 1, tempF: 180 };
/** The vertical well's flowing bottomhole pressure, psia. */
export const PWF = 600;
/** Starting state: porosity (fraction), log10 of permeability in md, reservoir pressure (psia). */
export const ROCK_DEFAULTS = { porosity: 0.15, logK: 0, pressure: 3000 };
/** The challenge: the least permeable rock that lets a vertical well flow this much, at this pressure. */
export const TARGET_MMCFD = 1;
export const CHALLENGE_PRESSURE = 3000;
const LOGK_STEP = 0.1;

/** Permeability in md from the slider's log10 value. */
export const permOf = (logK: number) => Math.pow(10, logK);

function rockOf(s: typeof ROCK_DEFAULTS): Rock {
  return { ...BASE_ROCK, porosity: s.porosity, permMd: permOf(s.logK) };
}

/** A vertical well's rate (MMcf/d) on the first demonstration's rock. */
export function explorerRate(s: typeof ROCK_DEFAULTS): number {
  return wellRate(rockOf(s), s.pressure, PWF);
}

/**
 * The challenge: at 3,000 psia, the least permeable rock on the slider's grid (steps of 0.1 in
 * log10) from which a vertical well flows at least 1 MMcf/d. Porosity doesn't matter.
 */
export function leastPermSolved(s: typeof ROCK_DEFAULTS): boolean {
  if (s.pressure !== CHALLENGE_PRESSURE) return false;
  const i = Math.round(s.logK / LOGK_STEP);
  const here = explorerRate({ ...s, logK: i * LOGK_STEP });
  const below = explorerRate({ ...s, logK: (i - 1) * LOGK_STEP });
  return here >= TARGET_MMCFD && below < TARGET_MMCFD;
}

/** "250 md", "0.25 md", "300 nanodarcies". */
export function permText(k: number): string {
  if (k >= 10) return `${fmt(Number(k.toPrecision(2)))} md`;
  if (k >= 0.001) return `${Number(k.toPrecision(2))} md`;
  return `${fmt(Number((k * 1e6).toPrecision(2)))} nanodarcies`;
}

/** "4.0 MMcf/d", "802 Mcf/d", "0.4 Mcf/d". */
export function rateText(mmcfd: number): string {
  if (mmcfd >= 1) return `${fmt(mmcfd, mmcfd >= 100 ? 0 : 1)} MMcf/d`;
  const mcf = mmcfd * 1000;
  return `${fmt(mcf, mcf >= 10 ? 0 : 1)} Mcf/d`;
}

/** Dots move faster as the well flows faster: px/s, compressed so both fields stay visible. */
function dotStyle(mmcfd: number) {
  const speed = 12 * Math.pow(Math.max(mmcfd, 0), 0.35);
  return speed > 0.4 ? { animationDuration: `${(18 / speed).toFixed(3)}s` } : { animationPlayState: 'paused' as const };
}

// The pore view: round sand grains on a square grid with cement between them. Pores sit where four
// grains meet, with an area that is the slider's porosity of each cell (water lining them, gas in the
// middle); pore throats run through the gaps between grains and widen with permeability.
const CELL = 40;
const COLS = 8;
const ROWS = 5;
const PX = 16;
const PY = 30;
const GRAIN_R = 0.38 * CELL;
const GRAIN = '#e4d8bf';
const GRAIN_EDGE = '#b9a988';
const CEMENT = '#cbbfa6';
const WATER = '#cfe2f1';
const GAS = tint(GRAPHIC.gold, 0.65);

function PoreView({ porosity, logK, rate }: { porosity: number; logK: number; rate: number }) {
  const rp = CELL * Math.sqrt(porosity / Math.PI);
  const rg = rp * Math.sqrt(1 - BASE_ROCK.waterSat);
  const t = clamp((logK + 4) / 7, 0, 1);
  const throat = 0.4 + 4.6 * t;
  const w = COLS * CELL;
  const h = ROWS * CELL;
  const pores: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= COLS; i++) for (let j = 0; j <= ROWS; j++) pores.push({ x: PX + i * CELL, y: PY + j * CELL });
  const grains: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) grains.push({ x: PX + (i + 0.5) * CELL, y: PY + (j + 0.5) * CELL });
  return (
    <g>
      <defs>
        <clipPath id="l21-pores">
          <rect x={PX} y={PY} width={w} height={h} rx={4} />
        </clipPath>
      </defs>
      <text className="ax" x={PX} y={18}>
        A slice of the rock, magnified
      </text>
      <g clipPath="url(#l21-pores)">
        <rect x={PX} y={PY} width={w} height={h} fill={CEMENT} />
        {pores.map((q, i) => (
          <g key={'p' + i}>
            <circle cx={q.x} cy={q.y} r={rp} fill={WATER} />
            <circle cx={q.x} cy={q.y} r={rg} fill={GAS} />
          </g>
        ))}
        {grains.map((g, i) => (
          <circle key={'g' + i} cx={g.x} cy={g.y} r={GRAIN_R} fill={GRAIN} stroke={GRAIN_EDGE} strokeWidth={0.8} />
        ))}
        {Array.from({ length: ROWS + 1 }, (_, j) => (
          <line key={'h' + j} x1={PX} x2={PX + w} y1={PY + j * CELL} y2={PY + j * CELL} stroke={GRAPHIC.violet} strokeWidth={throat} opacity={0.5} />
        ))}
        {Array.from({ length: COLS + 1 }, (_, i) => (
          <line key={'v' + i} x1={PX + i * CELL} x2={PX + i * CELL} y1={PY} y2={PY + h} stroke={GRAPHIC.violet} strokeWidth={throat} opacity={0.5} />
        ))}
        {[1, 3].map((j) => (
          <path key={'f' + j} d={`M${PX} ${PY + j * CELL} L${PX + w} ${PY + j * CELL}`} className="flow-dots" stroke={GRAPHIC.orange} strokeWidth={3} style={dotStyle(rate)} />
        ))}
      </g>
      <rect x={PX} y={PY} width={w} height={h} rx={4} fill="none" stroke="#9a9a9a" />
    </g>
  );
}

/** The cross-section: a seal over the reservoir layer, and a vertical well drawing gas in from both sides. The rate itself is in the readouts. */
function Section({ gip, rate }: { gip: number; rate: number }) {
  const x0 = 358;
  const x1 = 624;
  const xw = 540;
  const fill = tint(GRAPHIC.gold, 0.15 + 0.6 * clamp(gip / 60, 0, 1));
  return (
    <g>
      <text className="ax" x={x0} y={18}>
        The rock in the ground
      </text>
      <rect x={x0} y={30} width={x1 - x0} height={64} fill="#f1eee6" />
      <rect x={x0} y={94} width={x1 - x0} height={40} fill="#d8d6d0" />
      <rect x={x0} y={134} width={x1 - x0} height={44} fill={fill} />
      <rect x={x0} y={178} width={x1 - x0} height={48} fill="#e6e2d9" />
      <text className="ax" x={x0 + 6} y={118}>
        seal
      </text>
      <text x={x0 + 6} y={152} style={{ fontSize: 12, fontWeight: 500, fill: TEXT.gold }}>
        reservoir · {BASE_ROCK.thicknessFt} ft
      </text>
      <line x1={xw} x2={xw} y1={24} y2={178} stroke="#555" strokeWidth={4} />
      <rect x={xw - 9} y={20} width={18} height={10} fill="#555" />
      <path d={`M${x0 + 4} 168 L${xw - 4} 168`} className="flow-dots" stroke={GRAPHIC.orange} strokeWidth={3.5} style={dotStyle(rate)} />
      <path d={`M${x1 - 4} 168 L${xw + 4} 168`} className="flow-dots" stroke={GRAPHIC.orange} strokeWidth={3.5} style={dotStyle(rate)} />
      <text className="ax ax-e" x={xw - 12} y={52}>
        a vertical well
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// The second demonstration: the region's two fields.

type FieldId = 'sandDisc' | 'sandNow' | 'ridge';

interface Field {
  id: FieldId;
  name: string;
  rock: Rock;
  pressure: number;
}

const FIELDS: Field[] = [
  { id: 'sandDisc', name: 'Sandhill, at discovery', rock: SANDHILL_ROCK, pressure: SANDHILL_PI },
  { id: 'sandNow', name: 'Sandhill, today', rock: SANDHILL_ROCK, pressure: SANDHILL_P_NOW },
  { id: 'ridge', name: 'Ridgeback shale', rock: RIDGEBACK_ROCK, pressure: RIDGEBACK_PI },
];
const FIELD: Record<FieldId, Field> = Object.fromEntries(FIELDS.map((f) => [f.id, f])) as Record<FieldId, Field>;

export const FIELDS_DEFAULTS = { field: 'sandDisc' as FieldId, pwf: PWF };

/** Gas in place (Bcf per square mile) and a vertical well's rate (MMcf/d) for one of the fields. */
export function fieldNumbers(id: FieldId, pwf: number) {
  const f = FIELD[id];
  return { gip: gasInPlace(f.rock, f.pressure) / 1e9, rate: wellRate(f.rock, f.pressure, pwf) };
}

const BX0 = 176;
const BX1 = 372;
const GIP_MAX = 120;
const RX0 = 418;
const RX1 = 620;
/** Rate axis: log scale from 1 Mcf/d to 100,000 Mcf/d. */
const rx = (mmcfd: number) => RX0 + ((clamp(Math.log10(Math.max(mmcfd * 1000, 1e-9)), 0, 5) - 0) / 5) * (RX1 - RX0);
const gx = (bcf: number) => BX0 + (clamp(bcf, 0, GIP_MAX) / GIP_MAX) * (BX1 - BX0);

function FieldsChart({ rows, selected }: { rows: Array<Field & { gip: number; rate: number }>; selected: FieldId }) {
  return (
    <svg
      className="chart"
      viewBox="0 0 640 176"
      role="img"
      aria-label={`Gas in place per square mile and a vertical well’s rate for the region’s two fields. ${rows
        .map((r) => `${r.name}: ${fmt(r.gip, 1)} Bcf, ${rateText(r.rate)}`)
        .join('; ')}.`}
    >
      <text className="ax" x={BX0} y={14}>
        Gas in place, Bcf per square mile
      </text>
      <text className="ax" x={RX0} y={14}>
        A vertical well’s rate (log scale)
      </text>
      {[0, 40, 80, 120].map((v) => (
        <g key={'g' + v}>
          <line className={v ? 'gl' : 'base'} x1={gx(v)} x2={gx(v)} y1={24} y2={140} />
          <text className="ax ax-m" x={gx(v)} y={156}>
            {v}
          </text>
        </g>
      ))}
      {[0.001, 0.01, 0.1, 1, 10, 100].map((v, i) => (
        <g key={'r' + v}>
          <line className={i ? 'gl' : 'base'} x1={rx(v)} x2={rx(v)} y1={24} y2={140} />
          <text className="ax ax-m" x={rx(v)} y={156}>
            {['1 Mcf', '10', '100', '1 MMcf', '10', '100'][i]}
          </text>
        </g>
      ))}
      <text className="ax ax-e" x={RX1} y={172}>
        per day
      </text>
      {rows.map((r, i) => {
        const y = 30 + i * 38;
        const on = r.id === selected;
        return (
          <g key={r.id}>
            {on && <rect x={2} y={y - 5} width={636} height={34} rx={4} fill="#efede6" />}
            <text x={166} y={y + 16} textAnchor="end" style={{ fontSize: 13, fontWeight: on ? 600 : 400, fill: '#333' }}>
              {r.name}
            </text>
            <rect x={gx(0)} y={y + 4} width={gx(r.gip) - gx(0)} height={16} fill={GRAPHIC.gold} opacity={on ? 1 : 0.6} />
            <text x={gx(r.gip) + 5} y={y + 16} style={{ fontSize: 12, fill: TEXT.gold, fontWeight: on ? 600 : 400 }}>
              {fmt(r.gip, 1)}
            </text>
            <rect x={rx(0.001)} y={y + 4} width={Math.max(0, rx(r.rate) - rx(0.001))} height={16} fill={GRAPHIC.orange} opacity={on ? 1 : 0.6} />
            <text
              x={rx(r.rate) > RX1 - 70 ? rx(r.rate) - 5 : rx(r.rate) + 5}
              textAnchor={rx(r.rate) > RX1 - 70 ? 'end' : 'start'}
              y={y + 16}
              style={{ fontSize: 12, fill: rx(r.rate) > RX1 - 70 ? '#fff' : TEXT.orange, fontWeight: on ? 600 : 400 }}
            >
              {rateText(r.rate)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The third demonstration: a horizontal well in Ridgeback's shale, fractured in stages.

/** Most stages the slider allows: two miles of horizontal well. */
export const STAGES_MAX = 24;
export const HORIZONTAL_DEFAULTS = { stages: 12 };

/** The Ridgeback horizontal well with `stages` fracture stages. */
export function horizontalWell(stages: number): FracturedWell {
  return { stages, ...RIDGEBACK_FRACS };
}

/** Its rate (MMcf/d) at Ridgeback's discovery pressure, with the vertical well's flowing pressure. */
export function horizontalRate(stages: number): number {
  return fracturedWellRate(RIDGEBACK_ROCK, RIDGEBACK_PI, PWF, horizontalWell(stages));
}

/** Plan view: two miles of well across the strip, starting at the heel. */
const HX0 = 24;
const FT_PX = 592 / (STAGES_MAX * RIDGEBACK_FRACS.stageSpacingFt);
const HY = 70;
/** Rate bars: log scale from 1 Mcf/d to 100,000 Mcf/d. */
const HRX0 = 176;
const HRX1 = 620;
const hrx = (mmcfd: number) => HRX0 + (clamp(Math.log10(Math.max(mmcfd * 1000, 1e-9)), 0, 5) / 5) * (HRX1 - HRX0);
const FRACTURE = '#666';
const DRAINED = tint(GRAPHIC.gold, 0.45);

function HorizontalWellView({ stages, rate, vertical }: { stages: number; rate: number; vertical: number }) {
  const sp = RIDGEBACK_FRACS.stageSpacingFt * FT_PX;
  const half = RIDGEBACK_FRACS.halfLengthFt * FT_PX;
  const toe = HX0 + stages * sp;
  const mile = 5280 * FT_PX;
  const rows = [
    { label: 'A vertical well', q: vertical },
    { label: 'This horizontal well', q: rate },
  ];
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 252"
      role="img"
      aria-label={`From above: a horizontal well ${fmt(stages * RIDGEBACK_FRACS.stageSpacingFt)} feet long in Ridgeback’s shale with ${stages} fracture stage${stages === 1 ? '' : 's'}, ${fmt(RIDGEBACK_FRACS.stageSpacingFt)} feet apart, each reaching ${fmt(RIDGEBACK_FRACS.halfLengthFt)} feet into the rock on either side. It flows ${rateText(rate)}, against ${rateText(vertical)} for a vertical well.`}
    >
      <text className="ax" x={16} y={16}>
        The shale from above: the well’s horizontal section and its fractures
      </text>
      <rect x={16} y={HY - 40} width={608} height={80} fill="#f1eee6" />
      <rect x={HX0} y={HY - half} width={toe - HX0} height={2 * half} fill={DRAINED} />
      {Array.from({ length: stages }, (_, i) => {
        const x = HX0 + (i + 0.5) * sp;
        return <line key={i} x1={x} x2={x} y1={HY - half} y2={HY + half} stroke={FRACTURE} strokeWidth={2} />;
      })}
      <line x1={HX0} x2={toe} y1={HY} y2={HY} stroke="#555" strokeWidth={4} />
      <path d={`M${toe - 2} ${HY} L${HX0 + 2} ${HY}`} className="flow-dots" stroke={GRAPHIC.orange} strokeWidth={3} style={dotStyle(rate)} />
      <circle cx={HX0} cy={HY} r={6} fill="#555" />
      {[0, 1, 2].map((m) => (
        <g key={m}>
          <line className="base" x1={HX0 + m * mile} x2={HX0 + m * mile} y1={HY + 44} y2={HY + 50} />
          <text className={m === 0 ? 'ax' : m === 2 ? 'ax ax-e' : 'ax ax-m'} x={HX0 + m * mile + (m === 0 ? -3 : 0)} y={HY + 64}>
            {m === 0 ? '0' : m === 1 ? '1 mile' : '2 miles'}
          </text>
        </g>
      ))}
      <line className="base" x1={HX0} x2={HX0 + 2 * mile} y1={HY + 47} y2={HY + 47} />
      {[0.001, 0.01, 0.1, 1, 10, 100].map((v, i) => (
        <g key={'t' + v}>
          <line className={i ? 'gl' : 'base'} x1={hrx(v)} x2={hrx(v)} y1={146} y2={214} />
          <text className="ax ax-m" x={hrx(v)} y={230}>
            {['1 Mcf', '10', '100', '1 MMcf', '10', '100'][i]}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = 150 + i * 32;
        const inside = hrx(r.q) > HRX1 - 70;
        return (
          <g key={r.label}>
            <text x={166} y={y + 16} textAnchor="end" style={{ fontSize: 13, fontWeight: i ? 600 : 400, fill: '#333' }}>
              {r.label}
            </text>
            <rect x={hrx(0.001)} y={y + 4} width={Math.max(0, hrx(r.q) - hrx(0.001))} height={16} fill={GRAPHIC.orange} opacity={i ? 1 : 0.6} />
            <text
              x={inside ? hrx(r.q) - 5 : hrx(r.q) + 5}
              textAnchor={inside ? 'end' : 'start'}
              y={y + 16}
              style={{ fontSize: 12, fill: inside ? '#fff' : TEXT.orange, fontWeight: i ? 600 : 400 }}
            >
              {rateText(r.q)}
            </text>
          </g>
        );
      })}
      <text className="ax ax-e" x={HRX1} y={246}>
        per day
      </text>
    </svg>
  );
}

// Numbers quoted in the prose.
const DEF = rockOf(ROCK_DEFAULTS);
const DEF_GIP = gasInPlace(DEF, ROCK_DEFAULTS.pressure) / 1e9;
const DEF_SCF = 1 / gasFVF(ROCK_DEFAULTS.pressure, BASE_ROCK.tempF);
/** A vertical well's rate at the starting 1 md: the challenge is predicted from it. */
export const DEF_RATE = explorerRate(ROCK_DEFAULTS);
const GIP_6000 = gasInPlace(DEF, 6000) / 1e9;
const Z_3000 = zFactor(3000, BASE_ROCK.tempF);
const Z_6000 = zFactor(6000, BASE_ROCK.tempF);
const SAND_D = fieldNumbers('sandDisc', PWF);
const SAND_N = fieldNumbers('sandNow', PWF);
const RIDGE = fieldNumbers('ridge', PWF);
const PERM_RATIO = SANDHILL_ROCK.permMd / RIDGEBACK_ROCK.permMd;
const RATE_RATIO = SAND_D.rate / RIDGE.rate;
const SAND_D_MU = gasViscosity((SANDHILL_PI + PWF) / 2, SANDHILL_ROCK.tempF);
const NORTHLINE_BCFD = PIPELINE['calder-metro'].capacityBcfd;
const RIDGE_YEARS = (RIDGE.gip * 1e9) / (RIDGE.rate * 1e6) / 365.25;
const H_DEF = horizontalRate(HORIZONTAL_DEFAULTS.stages);
const H_DEF_AREA = fractureFaceArea(RIDGEBACK_ROCK, horizontalWell(HORIZONTAL_DEFAULTS.stages));
const H_PER_STAGE = horizontalRate(1);
const HALF_SPACING = RIDGEBACK_FRACS.stageSpacingFt / 2;
const H_DIST = fractureFlowDistance(horizontalWell(1));
/** The challenge's answer, computed from the grid. */
const ANSWER = (() => {
  for (let i = -40; i <= 30; i++) {
    const s = { ...ROCK_DEFAULTS, logK: i * LOGK_STEP };
    if (explorerRate(s) >= TARGET_MMCFD) return { k: permOf(s.logK), rate: explorerRate(s), below: explorerRate({ ...s, logK: (i - 1) * LOGK_STEP }) };
  }
  return { k: NaN, rate: NaN, below: NaN };
})();

export default function Lesson() {
  const s = useScenario('rock', ROCK_DEFAULTS);
  const { porosity, logK, pressure } = s.state;
  const k = permOf(logK);
  const rock = rockOf(s.state);
  const bg = gasFVF(pressure, BASE_ROCK.tempF);
  const gip = gasInPlace(rock, pressure) / 1e9;
  const rate = explorerRate(s.state);
  const solved = leastPermSolved(s.state);

  const f = useScenario('fields', FIELDS_DEFAULTS);
  const pwf = f.state.pwf;
  const rows = FIELDS.map((x) => ({ ...x, ...fieldNumbers(x.id, pwf) }));
  const sel = FIELD[f.state.field];
  const pAvg = (sel.pressure + pwf) / 2;
  const mu = gasViscosity(pAvg, sel.rock.tempF);
  const z = zFactor(pAvg, sel.rock.tempF);
  const geom = Math.log(drainageRadius(sel.rock.areaAcres) / WELLBORE_RADIUS_FT) - 0.75;
  const selRate = wellRate(sel.rock, sel.pressure, pwf);

  const h = useScenario('horizontal', HORIZONTAL_DEFAULTS);
  const stages = h.state.stages;
  const hWell = horizontalWell(stages);
  const hRate = horizontalRate(stages);
  const hArea = fractureFaceArea(RIDGEBACK_ROCK, hWell);
  const hDist = fractureFlowDistance(hWell);
  const hPAvg = (RIDGEBACK_PI + PWF) / 2;
  const hMu = gasViscosity(hPAvg, RIDGEBACK_ROCK.tempF);
  const hZ = zFactor(hPAvg, RIDGEBACK_ROCK.tempF);

  const status =
    pressure !== CHALLENGE_PRESSURE
      ? `Set the reservoir pressure back to ${fmt(CHALLENGE_PRESSURE)} psia first; it’s at ${fmt(pressure)}.`
      : logK === ROCK_DEFAULTS.logK
        ? `Work out your answer from the rate at ${permText(permOf(ROCK_DEFAULTS.logK))} before you move the slider.`
        : rate >= TARGET_MMCFD
          ? `At ${permText(k)} the well flows enough, but so would tighter rock.`
          : `At ${permText(k)} the well flows too little.`;

  return (
    <LessonPage id="gas/2.1">
      <P>
        Chapter 1 followed gas through pipes, compressors and meters, but every cubic foot of it began underground. To understand what limits the supply — why one field
        can deliver gas cheaply for decades while another needs thousands of wells — we have to start with the rock that holds it.
      </P>
      <P>
        Most gas began as the remains of microscopic plants and animals that settled into mud on ancient sea and lake floors. As more sediment piled on top,
        the mud was buried thousands of feet deep and slowly hardened into a dark rock called shale, and the organic matter in it was heated. Over millions of years the
        heat broke it down, first into oil and then, as the rock grew hotter still, into gas. The shale where this happens is the <b>source rock</b>.
      </P>
      <P>
        Gas is light, so it presses upward through whatever cracks and pore spaces it can find. Much of it escapes to the surface over geologic time. Some is caught on
        the way by a <b>seal</b> — a layer it can’t pass, such as a tight shale or a bed of salt — bent or faulted so that the gas collects underneath it, like air under
        an upturned bowl. The porous rock beneath the seal, usually a sandstone or a limestone, is a <b>conventional reservoir</b>, and the region’s old Sandhill field is
        one. And some gas never leaves the source rock at all. The Ridgeback basin produces gas straight out of the shale that made it.
      </P>
      <P>
        A reservoir rock is a packing of grains with spaces between them. The share of the rock’s volume that is space is its <b>porosity</b>. The
        rock was laid down under water, and some water stays behind, clinging to the grains, so gas fills only part of each pore; our rock is {pct(BASE_ROCK.waterSat)}{' '}
        water. In the next demonstration, a square mile of rock {BASE_ROCK.thicknessFt} feet thick sits beneath a seal at {BASE_ROCK.tempF} °F, with a vertical well drilled
        into the middle of it. The magnified slice shows the grains, and the water and gas between them. Set the rock’s porosity, its{' '}
        <K tone="violet">permeability</K> and the <K tone="blue">pressure</K> of the gas in its pores:
      </P>

      <Figure name="Reservoir Explorer" scenario={s}>
        <svg
          className="diagram"
          viewBox="0 0 640 236"
          role="img"
          aria-label={`A square mile of rock ${BASE_ROCK.thicknessFt} feet thick with ${pct(porosity)} porosity and a permeability of ${permText(k)}, at ${fmt(pressure)} psia. It holds ${fmt(gip, 1)} Bcf of gas; a vertical well flows ${rateText(rate)}.`}
        >
          <PoreView porosity={porosity} logK={logK} rate={rate} />
          <Section gip={gip} rate={rate} />
        </svg>
        <Legend
          items={[
            { label: 'Grains', color: GRAIN },
            { label: 'Cement', color: CEMENT },
            { label: 'Water', color: WATER },
            { label: 'Gas', color: GAS },
            { label: 'Connections between pores', color: GRAPHIC.violet, kind: 'line' },
            { label: 'Gas flowing to the well', color: GRAPHIC.orange, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'standard cubic feet per cubic foot of pore space', value: fmt(1 / bg), tone: 'blue' },
            { label: `a vertical well’s rate, with ${fmt(PWF)} psia held at its bottom`, value: rateText(rate), tone: 'orange' },
          ]}
        />
        <Slider label="Porosity" value={porosity} min={0.02} max={0.3} step={0.01} onChange={(v) => s.set({ porosity: v })} display={pct(porosity)} />
        <Slider label="Permeability" tone="violet" value={logK} min={-4} max={3} step={LOGK_STEP} onChange={(v) => s.set({ logK: v })} display={permText(k)} />
        <Slider label="Reservoir pressure" tone="blue" value={pressure} min={1000} max={6000} step={100} onChange={(v) => s.set({ pressure: v })} display={`${fmt(pressure)} psia`} />
        <Eq
          label={`Gas in place equals 43,560 square feet per acre times 640 acres times ${BASE_ROCK.thicknessFt} feet times ${pct(porosity)} porosity times ${pct(1 - BASE_ROCK.waterSat)} gas, divided by Bg of ${bg.toFixed(5)}: ${fmt(gip, 1)} Bcf`}
        >
          <K c="energy">G</K>
          <Op>=</Op>
          <Frac
            top={
              <span>
                43,560 × {BASE_ROCK.areaAcres} × {BASE_ROCK.thicknessFt} × {pct(porosity)} × (1 − {pct(BASE_ROCK.waterSat)})
              </span>
            }
            bottom={<K tone="blue">{bg.toFixed(5)}</K>}
          />
          <Op>=</Op>
          <K c="energy">{fmt(gip, 1)} Bcf</K>
        </Eq>
      </Figure>

      <P>
        The equation counts the gas. There are 43,560 square feet in an acre and 640 acres in a square mile; times the thickness, that’s the volume of rock. Times the
        porosity and the share of the pores not taken up by water, it’s the volume of gas-filled space. The last step divides by B<Sub>g</Sub>, the cubic feet of pore space
        one standard cubic foot of gas takes up at the reservoir’s pressure and temperature. At the starting {fmt(ROCK_DEFAULTS.pressure)} psia, gas is so compressed that
        every cubic foot of pore space holds {fmt(DEF_SCF)} standard cubic feet, and the square mile holds {fmt(DEF_GIP, 1)} Bcf — enough to keep Northline full for{' '}
        {fmt(DEF_GIP / NORTHLINE_BCFD)} days.
      </P>
      <P>
        Double the pressure to 6,000 psia and the gas in place rises to {fmt(GIP_6000, 1)} Bcf, not to twice {fmt(DEF_GIP, 1)}. That’s compressibility from{' '}
        <a href={lessonHref('gas/1.2')}>Lesson 1.2</a> at work: at {BASE_ROCK.tempF} °F, Z climbs from {fmt(Z_3000, 2)} at 3,000 psia to {fmt(Z_6000, 2)} at 6,000, so the
        molecules crowd one another and the extra pressure buys less extra gas. Pressure in a reservoir comes mostly from depth. In most rock it rises by roughly 0.43 to
        0.5 psi for every foot down, the weight of the water filling the pores above, so deep reservoirs hold more gas in the same space. Sandstones commonly have
        porosities of 10 to 30%; gas shales, more like 4 to 10%.
      </P>

      <H2>Holding gas is not giving it up</H2>
      <P>
        Now move the permeability slider. The gas in place doesn’t change at all — but the well’s rate does, in exact proportion. <K tone="violet">Permeability</K> measures
        how easily a fluid moves through the connected pores of a rock, and porosity says nothing about it: a rock can be full of pores that barely connect. It’s
        measured in darcies, after Henry Darcy, the French engineer who in the 1850s measured water flowing through sand. Oil and gas
        rocks are counted in thousandths of a darcy, millidarcies (md). A good conventional sandstone measures from a few millidarcies to more than a thousand; the shales
        that hold gas, tens to hundreds of billionths of a darcy, nanodarcies.
      </P>
      <P>
        At the starting {permText(permOf(ROCK_DEFAULTS.logK))}, the vertical well flows {rateText(DEF_RATE)}, drawing the pressure around it down toward the {fmt(PWF)} psia held at its
        bottom while it flows, its <K tone="blue">flowing pressure</K>. Halve the permeability and the rate halves; turn it down to about Ridgeback’s{' '}
        {permText(RIDGEBACK_ROCK.permMd)} and the same square mile, with the same gas in it, gives up a trickle. Raising the pressure helps the rate as well as the gas in place, since a well, like a pipe in <a href={lessonHref('gas/1.3')}>Lesson 1.3</a>, flows with the
        difference of the squared pressures. Porosity decides how much gas there is; permeability decides how fast it can come out.
      </P>

      <Challenge
        id="a"
        figure="Reservoir Explorer"
        question={`A vertical well here needs to flow at least ${TARGET_MMCFD} MMcf/d to pay for itself. With the reservoir at ${fmt(CHALLENGE_PRESSURE)} psia, what’s the least permeable rock it can be drilled into? Predict it from the ${rateText(DEF_RATE)} the well flows at ${permText(permOf(ROCK_DEFAULTS.logK))}, then set the permeability to check.`}
        solved={solved}
        status={status}
        success={`Solved: ${permText(ANSWER.k)}. The rate is proportional to permeability, so a well that flows ${rateText(DEF_RATE)} at ${permText(permOf(ROCK_DEFAULTS.logK))} flows ${TARGET_MMCFD} MMcf/d at ${TARGET_MMCFD} ÷ ${fmt(DEF_RATE, 1)} = ${fmt(TARGET_MMCFD / DEF_RATE, 2)} md. The slider’s ${permText(ANSWER.k)} gives ${rateText(ANSWER.rate)}; one step tighter, it gives ${rateText(ANSWER.below)}. Porosity made no difference — it changes how much gas there is, not how fast it moves. Even this marginal rock is about ${fmt(Math.round(ANSWER.k / RIDGEBACK_ROCK.permMd / 10) * 10)} times as permeable as Ridgeback’s shale.`}
      />

      <H2>Two fields</H2>
      <P>
        The region’s two fields sit far apart on the permeability slider of <FigRef to="Reservoir Explorer">the first demonstration</FigRef>. Sandhill is a {SANDHILL_ROCK.thicknessFt}-foot sandstone with {pct(SANDHILL_ROCK.porosity)} porosity
        and a permeability of {permText(SANDHILL_ROCK.permMd)}, discovered at {fmt(SANDHILL_PI)} psia and produced for decades since, so its pressure today is down to{' '}
        {fmt(SANDHILL_P_NOW)}. Ridgeback is a {RIDGEBACK_ROCK.thicknessFt}-foot shale with{' '}
        {pct(RIDGEBACK_ROCK.porosity)} porosity, deeper and hotter, at {fmt(RIDGEBACK_PI)} psia — and {fmt(PERM_RATIO)} times less permeable. The next demonstration puts
        a square mile of each side by side, with the vertical well’s flow equation written out for the field you choose. Change the flowing pressure:
      </P>

      <Figure name="Reservoir Explorer · two fields" scenario={f}>
        <Segmented
          label="Field"
          value={f.state.field}
          onChange={(v) => f.set({ field: v })}
          options={FIELDS.map((x) => ({ value: x.id, label: x.name }))}
        />
        <FieldsChart rows={rows} selected={f.state.field} />
        <DataTable
          caption="The rock and the pressure of each field"
          rows={FIELDS}
          rowKey={(r) => r.id}
          rowClass={(r) => (r.id === f.state.field ? 'hl' : '')}
          columns={[
            { label: 'Field', cell: (r) => r.name },
            { label: 'Thickness', cell: (r) => `${r.rock.thicknessFt} ft`, align: 'right' },
            { label: 'Porosity', cell: (r) => pct(r.rock.porosity), align: 'right' },
            { label: <Tn tone="violet">Permeability</Tn>, cell: (r) => permText(r.rock.permMd), align: 'right' },
            { label: <Tn tone="blue">Pressure</Tn>, cell: (r) => `${fmt(r.pressure)} psia`, align: 'right' },
          ]}
        />
        <Eq
          label={`Rate equals ${permText(sel.rock.permMd)} times ${sel.rock.thicknessFt} feet times (${fmt(sel.pressure)} squared minus ${fmt(pwf)} squared), over 1422 times ${fmt(rankine(sel.rock.tempF), 1)} times ${fmt(mu, 4)} centipoise times Z of ${fmt(z, 3)} times ${fmt(geom, 2)}: ${rateText(selRate)}`}
        >
          <K tone="orange">q</K>
          <Op>=</Op>
          <Frac
            top={
              <span>
                <K tone="violet">{Number(sel.rock.permMd.toPrecision(2))}</K> × {sel.rock.thicknessFt} × (<K tone="blue">{fmt(sel.pressure)}</K>
                <Sup>2</Sup> − <K tone="blue">{fmt(pwf)}</K>
                <Sup>2</Sup>)
              </span>
            }
            bottom={
              <span>
                1,422 × <K tone="teal">{fmt(rankine(sel.rock.tempF), 1)}</K> × {fmt(mu, 4)} × {fmt(z, 3)} × {fmt(geom, 2)}
              </span>
            }
          />
          <Op>=</Op>
          <K tone="orange">{fmt(selRate * 1000, selRate * 1000 >= 10 ? 0 : 1)} Mcf/d</K>
        </Eq>
        <Slider
          label="Flowing pressure"
          tone="blue"
          value={pwf}
          min={200}
          max={1400}
          step={50}
          onChange={(v) => f.set({ pwf: v })}
          display={`${fmt(pwf)} psia`}
        />
      </Figure>

      <P>
        A square mile of Ridgeback holds {fmt(RIDGE.gip)} Bcf, {fmt(RIDGE.gip / SAND_D.gip, 1)} times what Sandhill held at discovery: the shale
        is far thicker, and its high pressure packs the gas tightly. Yet a vertical well into Sandhill flowed {rateText(SAND_D.rate)} at discovery, and one into Ridgeback
        flows {rateText(RIDGE.rate)} — about {fmt(Math.round(RATE_RATIO / 10) * 10)} times less. At that rate, the well would take some{' '}
        {fmt(Math.round(RIDGE_YEARS / 1000) * 1000)} years to produce the gas beneath its square mile.
      </P>
      <P>
        The equation is Darcy’s law, worked out for gas flowing inward from all sides to a well. The rate is the permeability times the thickness — the rock’s ability to
        conduct — times the difference of the squared pressures, divided by terms that resist the flow: the gas’s absolute temperature in degrees Rankine, its viscosity
        (about {fmt(SAND_D_MU, 3)} centipoise for Sandhill’s gas, against about 1 for water), its compressibility factor Z, and a geometric term for
        gas converging on a hole {fmt(WELLBORE_RADIUS_FT * 24, 1)} inches across from a circle{' '}
        {fmt(drainageRadius(640))} feet in radius. The 1,422 makes the field units come out in thousands of cubic feet a day. The equation assumes the pressure has
        settled into a steady pattern across the whole square mile, which in shale would take centuries; <a href={lessonHref('gas/2.3')}>Lesson 2.3</a> looks at
        what happens before then. But no version of the arithmetic rescues a vertical well in rock that tight.
      </P>
      <P>
        Sandhill’s problem is different. Its rock still conducts well, but {fmt(SAND_D.gip - SAND_N.gip, 1)} Bcf of every square mile’s {fmt(SAND_D.gip, 1)} have already
        been produced, the pressure has fallen with it, and a well flows {rateText(SAND_N.rate)} where it once flowed {rateText(SAND_D.rate)}. Lowering the flowing
        pressure helps a little, since the well flows on the difference of the squares, but it can’t restore what depletion took away.
      </P>

      <H2>Reaching more rock</H2>
      <P>
        The flow equation’s rate grows with k × h, the permeability times the thickness: the height of the rock face the gas flows into. For a vertical well that
        face is the wall of an {fmt(WELLBORE_RADIUS_FT * 24, 1)}-inch hole, and the gas has to converge on it from thousands of feet away. The answer for shale was to
        give the gas a vastly larger face. Two techniques, combined and refined in the 1990s and 2000s, did that.{' '}
        <b>Horizontal drilling</b> turns the well sideways once it reaches the shale and runs it along the layer for a mile or two, instead of crossing its{' '}
        {RIDGEBACK_ROCK.thicknessFt} feet. <b>Hydraulic fracturing</b> then pumps water and sand down the well at high pressure, in stage after stage along that horizontal
        section, cracking the rock; the sand props the cracks open.
      </P>
      <P>
        In the next demonstration, a horizontal well runs through Ridgeback’s shale with a fracture stage every {fmt(RIDGEBACK_FRACS.stageSpacingFt)} feet, each crack
        reaching {fmt(RIDGEBACK_FRACS.halfLengthFt)} feet into the rock on either side, through the whole layer. As before, {fmt(PWF)} psia is held at its bottom. Add
        stages:
      </P>

      <Figure name="Reservoir Explorer · horizontal well" scenario={h}>
        <HorizontalWellView stages={stages} rate={hRate} vertical={RIDGE.rate} />
        <Legend
          items={[
            { label: 'The well, turning sideways at the dot', color: '#555', kind: 'line' },
            { label: 'Fractures', color: FRACTURE, kind: 'line' },
            { label: 'Rock between the fractures', color: DRAINED },
            { label: 'Gas flowing to the surface', color: GRAPHIC.orange, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'rock face the gas flows into', value: `${fmt(hArea / 1e6, 1)} million ft²` },
            { label: 'times a vertical well’s rate', value: `${fmt(hRate / RIDGE.rate)}×`, tone: 'orange' },
          ]}
        />
        <Slider
          label="Fracture stages"
          value={stages}
          min={1}
          max={STAGES_MAX}
          step={1}
          onChange={(v) => h.set({ stages: v })}
          display={`${stages} · ${fmt(stages * RIDGEBACK_FRACS.stageSpacingFt)} ft of well`}
        />
        <Eq
          label={`Rate equals ${permText(RIDGEBACK_ROCK.permMd)} times ${fmt(hArea)} square feet times (${fmt(RIDGEBACK_PI)} squared minus ${fmt(PWF)} squared), over 8935 times ${fmt(rankine(RIDGEBACK_ROCK.tempF), 1)} times ${fmt(hMu, 4)} centipoise times Z of ${fmt(hZ, 3)} times ${fmt(hDist, 1)} feet: ${rateText(hRate)}`}
        >
          <K tone="orange">q</K>
          <Op>=</Op>
          <Frac
            top={
              <span>
                <K tone="violet">{Number(RIDGEBACK_ROCK.permMd.toPrecision(2))}</K> × {fmt(hArea)} × (<K tone="blue">{fmt(RIDGEBACK_PI)}</K>
                <Sup>2</Sup> − <K tone="blue">{fmt(PWF)}</K>
                <Sup>2</Sup>)
              </span>
            }
            bottom={
              <span>
                {fmt(LINEAR_FLOW_CONSTANT)} × <K tone="teal">{fmt(rankine(RIDGEBACK_ROCK.tempF), 1)}</K> × {fmt(hMu, 4)} × {fmt(hZ, 3)} × {fmt(hDist, 1)}
              </span>
            }
          />
          <Op>=</Op>
          <K tone="orange">{fmt(hRate * 1000)} Mcf/d</K>
        </Eq>
      </Figure>

      <P>
        With {HORIZONTAL_DEFAULTS.stages} stages along a mile, the well opens {fmt(H_DEF_AREA / 1e6, 1)} million square feet of rock face to the gas, and no gas between the
        fractures is more than {fmt(HALF_SPACING)} feet from one. It flows {rateText(H_DEF)}, about {fmt(Math.round(H_DEF / RIDGE.rate / 10) * 10)} times a vertical
        well’s {rateText(RIDGE.rate)}, and each stage adds the same face and the same {fmt(H_PER_STAGE, 2)} MMcf/d. The equation is Darcy’s law again, written for gas moving
        straight toward a flat face instead of converging on a hole: the permeability times the face’s area, times the difference of the squared pressures, over the same
        resisting terms and the distance the gas crosses — effectively {fmt(H_DIST)} feet, a third of the {fmt(HALF_SPACING)}, since most of the gas starts nearer a face.
        (The {fmt(LINEAR_FLOW_CONSTANT)} is 2π × 1,422.) It too assumes the flow has settled, but across {fmt(HALF_SPACING)} feet of shale that takes a few years, not
        centuries. Together, the two techniques made source rock that no one could produce the largest source of gas in the United States.
      </P>
      <P>
        A well like that doesn’t produce at a steady rate, though, and neither does one in Sandhill’s sandstone. Every cubic foot that flows out lowers the pressure that
        pushes the next one. In the <a href={lessonHref('gas/2.2')}>next lesson</a> we’ll drill a well and watch its rate and its reservoir’s pressure fall together over the
        years.
      </P>
    </LessonPage>
  );
}
