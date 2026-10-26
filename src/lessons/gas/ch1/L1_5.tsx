import {
  Caption,
  Challenge,
  Checkbox,
  DataTable,
  Eq,
  FigRef,
  Figure,
  Frac,
  GRAPHIC,
  H2,
  K,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  Sub,
  TEXT,
  fmt,
  lessonHref,
  pct,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { scfPerCubicFoot, zFactor } from '../../../engines/gas/eos';
import { BTU_PER_THERM, GJ_PER_MMBTU, MMBTU_PER_MCF, MMBTU_PER_MWH, STD_PSIA, STD_TEMP_F, psia, rankine } from '../../../engines/gas/properties';
import { stationLine } from '../../../engines/gas/compression';
import { PIPELINE, stationLineOf } from '../../../model/gas/world';
import { COST_RECIPE } from '../../../engines/market/offerCost';
import { psigFmt } from '../shared/format';

// ---------------------------------------------------------------------------
// The custody-transfer meter at Metro's end of Northline.

/** Actual cubic feet the meter counts in the hour shown. */
export const METER_READING = 1_000_000;
/** A simulated hub price, $/MMBtu, for valuing the hour's gas. */
export const HUB_PRICE = 3;
const NORTHLINE = PIPELINE['calder-metro'];

export const METER_DEFAULTS = { pressure: NORTHLINE.minDeliveryPsig, temp: 50, hhv: 1037, ideal: false };

export interface MeterHour {
  /** Line pressure, psia. */
  p: number;
  /** Compressibility factor at line conditions. */
  z: number;
  /** Standard cubic feet per actual cubic foot, with compressibility. */
  scfPerCf: number;
  /** The same if the gas were treated as ideal. */
  idealScfPerCf: number;
  /** Standard cubic feet the flow computer reports (ideal if `ideal`). */
  scf: number;
  /** MMBtu the flow computer reports. */
  mmbtu: number;
  /** MMBtu really delivered. */
  trueMMBtu: number;
}

/** Converts the meter's reading of actual cubic feet into standard volume and energy. */
export function meterHour(pressurePsig: number, tempF: number, hhv: number, ideal = false): MeterHour {
  const p = psia(pressurePsig);
  const z = zFactor(p, tempF);
  const scfPerCf = scfPerCubicFoot(p, tempF);
  const idealScfPerCf = (p / STD_PSIA) * (rankine(STD_TEMP_F) / rankine(tempF));
  const scf = METER_READING * (ideal ? idealScfPerCf : scfPerCf);
  return { p, z, scfPerCf, idealScfPerCf, scf, mmbtu: (scf * hhv) / 1e6, trueMMBtu: (METER_READING * scfPerCf * hhv) / 1e6 };
}

// ---------------------------------------------------------------------------
// A household meter: a quarter psi above the atmosphere, read in hundreds of cubic feet.

/** Household delivery pressure, psig: about 7 inches of water column. */
export const HOME_PSIG = 0.25;
/** The home meter's gas is taken to be at 60 °F. */
const HOME_TEMP_F = 60;
/** Standard cubic feet in a cubic foot at the home meter. */
export const HOME_SCF_PER_CF = scfPerCubicFoot(psia(HOME_PSIG), HOME_TEMP_F);
/** An illustrative retail price, the same number per CCF or per therm. */
export const RETAIL_PRICE = 1.3;
export const BILL_DEFAULTS = { ccf: 120, hhv: 1037 };

/** Therms in one CCF (100 cubic feet at the meter) of gas with this heating value. */
export function thermsPerCcf(hhv: number): number {
  return (100 * HOME_SCF_PER_CF * hhv) / BTU_PER_THERM;
}

/** The heating value, to the nearest Btu/scf, at which a CCF on the meter is one therm. */
export const CCF_THERM_HHV = Math.round(BTU_PER_THERM / (100 * HOME_SCF_PER_CF));

/** The challenge: a per-CCF and a per-therm bill at the same rate agree when a CCF is one therm. */
export function billsEqualSolved(hhv: number): boolean {
  return hhv === CCF_THERM_HHV;
}

// Numbers quoted in the prose.
const DEF = meterHour(METER_DEFAULTS.pressure, METER_DEFAULTS.temp, METER_DEFAULTS.hhv);
const DEF_IDEAL = meterHour(METER_DEFAULTS.pressure, METER_DEFAULTS.temp, METER_DEFAULTS.hhv, true);
const AT_MAOP = meterHour(NORTHLINE.maopPsig, METER_DEFAULTS.temp, METER_DEFAULTS.hhv);
const COLD = meterHour(METER_DEFAULTS.pressure, 30, METER_DEFAULTS.hhv);
const WARM = meterHour(METER_DEFAULTS.pressure, 80, METER_DEFAULTS.hhv);
const NORTHLINE_HOUR_MMCF = (NORTHLINE.capacityBcfd * 1000) / 24;
/** The share of Northline's gas its compressor stations burn at full flow (Lesson 1.4). */
export const NORTHLINE_FUEL_SHARE = stationLine(stationLineOf(NORTHLINE), NORTHLINE.capacityBcfd * 1000).fuelShare;
const NORTHLINE_DAY_MMBTU = NORTHLINE.capacityBcfd * 1e6 * MMBTU_PER_MCF;
const DEF_TPC = thermsPerCcf(BILL_DEFAULTS.hhv);
const DEF_THERMS = BILL_DEFAULTS.ccf * DEF_TPC;
/** The electricity course's Lakeside combined-cycle plant, MMBtu burned per MWh. */
const LAKESIDE_HEAT_RATE = COST_RECIPE.cc1.heatRate;

// Pressure gauge sweep: 0 psig at −135°, the line's MAOP at +135°.
function needle(psig: number, cx: number, cy: number, r: number) {
  const a = ((-135 + (270 * Math.min(psig, NORTHLINE.maopPsig)) / NORTHLINE.maopPsig) * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

const SIGNAL = { fill: 'none', stroke: '#b5b5b5', strokeWidth: 1.2, strokeDasharray: '3 3' };

export default function Lesson() {
  const m = useScenario('meter', METER_DEFAULTS);
  const { pressure, temp, hhv, ideal } = m.state;
  const hr = meterHour(pressure, temp, hhv, ideal);
  const shown = ideal ? hr.idealScfPerCf : hr.scfPerCf;
  const value = hr.mmbtu * HUB_PRICE;
  const lost = hr.trueMMBtu - hr.mmbtu;
  const n = needle(pressure, 262, 104, 17);
  const mercury = 58 * Math.max(0, Math.min(1, (temp - 20) / 80));
  const pipeFill = tint(GRAPHIC.gold, 0.08 + 0.62 * Math.min(1, hr.scfPerCf / 131));

  const b = useScenario('bill', BILL_DEFAULTS);
  const tpc = thermsPerCcf(b.state.hhv);
  const scf = b.state.ccf * 100 * HOME_SCF_PER_CF;
  const therms = b.state.ccf * tpc;
  const dth = therms / 10;
  const byVolume = b.state.ccf * RETAIL_PRICE;
  const byEnergy = therms * RETAIL_PRICE;
  const solved = billsEqualSolved(b.state.hhv);

  const units = [
    { key: 'ccf', unit: 'CCF on the meter (100 cubic feet each)', value: fmt(b.state.ccf) },
    { key: 'scf', unit: 'Standard cubic feet', value: fmt(scf) },
    { key: 'therm', unit: 'Therms (100,000 Btu)', value: fmt(therms, 1) },
    { key: 'dth', unit: 'Dekatherms, or MMBtu', value: fmt(dth, 2) },
    { key: 'gj', unit: 'Gigajoules', value: fmt(dth * GJ_PER_MMBTU, 2) },
    { key: 'kwh', unit: 'Kilowatt-hours', value: fmt((dth / MMBTU_PER_MWH) * 1000) },
  ];

  return (
    <LessonPage id="gas/1.5">
      <P>
        The previous lesson ended with gas being burned to move gas: Northline’s three compressor stations consume about {pct(NORTHLINE_FUEL_SHARE, 1)} of what flows
        through them. Whatever survives the trip reaches Metro, where custody passes from Northline to the city’s gas utility. The utility already owns the gas — it
        bought it at Calder Hub and pays Northline only to carry it — but the handover is where both sides settle how much was delivered, and every such handover
        happens at a meter. A meter has an awkward job. It counts volume — cubic feet sliding past — but nobody buys gas for its volume. They buy it
        to burn, so what they pay for is <K c="energy">energy</K>.
      </P>
      <P>
        Volume is a poor stand-in for energy, for two reasons we’ve already met. How much gas fits in a cubic foot depends on its <K tone="blue">pressure</K> and{' '}
        <K tone="teal">temperature</K> (<a href={lessonHref('gas/1.2')}>Lesson 1.2</a>), and a standard cubic foot of one gas can carry more energy than another’s (
        <a href={lessonHref('gas/1.1')}>Lesson 1.1</a>). Turning a meter reading into a bill takes both corrections.
      </P>
      <P>
        Here is the station at Metro’s end of Northline. The meter — on a line this size usually an ultrasonic meter, which times pulses of sound across the pipe, or
        an orifice plate — has counted {fmt(METER_READING)} actual cubic feet of gas in the past hour. Transmitters report the line’s pressure and temperature, and a gas
        chromatograph, an instrument that separates a small sample into its components, analyzes the gas every few minutes and works out its heating value. A flow
        computer combines the four numbers. In the next demonstration, change the conditions the meter sees:
      </P>

      <Figure name="Gas Measurement Lab" scenario={m}>
        <svg
          className="diagram"
          viewBox="0 0 640 228"
          role="img"
          aria-label={`A meter on Northline counts ${fmt(METER_READING)} actual cubic feet in an hour at ${psigFmt(pressure)} and ${temp} °F, with gas of ${hhv} Btu per standard cubic foot. The flow computer reports ${fmt(hr.scf / 1e6, 1)} MMcf, or ${fmt(hr.mmbtu)} MMBtu${ideal ? ', treating the gas as ideal' : ''}.`}
        >
          {/* Flow computer and the signal lines feeding it. */}
          <rect x={230} y={8} width={374} height={48} rx={4} fill="#fcfcfb" stroke={ideal ? GRAPHIC.red : '#9a9a9a'} strokeWidth={1.2} />
          <text x={417} y={26} textAnchor="middle" className="ax">
            flow computer{ideal ? ' · treating the gas as ideal' : ''}
          </text>
          <text x={417} y={46} textAnchor="middle" style={{ fontSize: 14, fontWeight: 500, fill: '#333' }}>
            <tspan>{fmt(hr.scf / 1e6, 1)} MMcf</tspan>
            <tspan fill="#9a9a9a"> · </tspan>
            <tspan fill={TEXT.gold}>{fmt(hr.mmbtu)} MMBtu</tspan>
          </text>
          <path d="M148 148 L148 31 L230 31" {...SIGNAL} />
          <path d="M262 82 L262 56" {...SIGNAL} />
          <path d="M372 72 L372 56" {...SIGNAL} />
          <path d="M537 80 L537 56" {...SIGNAL} />

          {/* The pipe, shaded by how densely the gas is packed, with gas moving through it. */}
          <rect x={16} y={160} width={608} height={36} fill={pipeFill} stroke="#9a9a9a" strokeWidth={1.5} />
          <path d="M16 178 L624 178" className="flow-dots" stroke="#fff" strokeWidth={4} style={{ animationDuration: '0.5s' }} />
          <text x={16} y={150} className="ax">
            Northline →
          </text>
          <text x={624} y={214} textAnchor="end" className="ax">
            to Metro’s utility →
          </text>

          {/* Meter. */}
          <rect x={102} y={148} width={92} height={60} rx={6} fill="#ecebe6" stroke="#555" strokeWidth={1.5} />
          <text x={148} y={182} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: '#333' }}>
            meter
          </text>
          <text x={148} y={224} textAnchor="middle" className="ax">
            {fmt(METER_READING)} actual ft³ this hour
          </text>

          {/* Pressure gauge. */}
          <line x1={262} y1={126} x2={262} y2={160} stroke="#777" strokeWidth={3} />
          <circle cx={262} cy={104} r={22} fill="#fff" stroke="#555" strokeWidth={1.5} />
          <line x1={262} y1={104} x2={n.x} y2={n.y} stroke={GRAPHIC.blue} strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={262} cy={104} r={3} fill="#555" />
          <text x={292} y={98} className="ax">
            pressure
          </text>
          <text x={292} y={116} style={{ fontSize: 14, fontWeight: 500, fill: TEXT.blue }}>
            {psigFmt(pressure)}
          </text>

          {/* Thermometer. */}
          <line x1={372} y1={150} x2={372} y2={160} stroke="#777" strokeWidth={3} />
          <rect x={367} y={72} width={10} height={72} rx={5} fill="#fff" stroke="#555" strokeWidth={1.2} />
          <rect x={369.5} y={140 - mercury} width={5} height={mercury + 4} fill={GRAPHIC.teal} />
          <circle cx={372} cy={146} r={8} fill={GRAPHIC.teal} stroke="#555" strokeWidth={1.2} />
          <text x={388} y={98} className="ax">
            temperature
          </text>
          <text x={388} y={116} style={{ fontSize: 14, fontWeight: 500, fill: TEXT.teal }}>
            {temp} °F
          </text>

          {/* Gas chromatograph, sampling the line. */}
          <line x1={537} y1={130} x2={537} y2={160} stroke="#777" strokeWidth={2} />
          <rect x={470} y={80} width={134} height={50} rx={4} fill="#fff" stroke="#555" strokeWidth={1.2} />
          <text x={537} y={99} textAnchor="middle" className="ax">
            chromatograph
          </text>
          <text x={537} y={119} textAnchor="middle" style={{ fontSize: 14, fontWeight: 500, fill: TEXT.gold }}>
            {fmt(hhv)} Btu/scf
          </text>
        </svg>
        <Readouts
          items={[
            { label: 'standard ft³ per actual ft³', value: `× ${fmt(shown, 1)}` },
            { label: `value at a simulated $${HUB_PRICE.toFixed(2)}/MMBtu`, value: usd(value), tone: 'green' },
          ]}
        />
        <Eq
          label={`Standard volume equals ${fmt(METER_READING)} actual cubic feet times ${fmt(hr.p, 1)} over ${STD_PSIA} psia times ${fmt(rankine(STD_TEMP_F), 2)} over ${fmt(rankine(temp), 2)} degrees Rankine${ideal ? '' : ` divided by Z of ${fmt(hr.z, 3)}`}, which is ${fmt(hr.scf / 1e6, 1)} MMcf`}
        >
          <span>
            V<Sub>std</Sub>
          </span>
          <Op>=</Op>
          <span>{fmt(METER_READING)} ft³</span>
          <Op>×</Op>
          <Frac top={<K tone="blue">{fmt(hr.p, 1)} psia</K>} bottom={`${STD_PSIA} psia`} />
          <Op>×</Op>
          <Frac top={`${fmt(rankine(STD_TEMP_F))} °R`} bottom={<K tone="teal">{fmt(rankine(temp))} °R</K>} />
          {!ideal && (
            <>
              <Op>×</Op>
              <Frac top="1" bottom={`Z = ${fmt(hr.z, 3)}`} />
            </>
          )}
          <Op>=</Op>
          <span>{fmt(hr.scf / 1e6, 1)} MMcf</span>
        </Eq>
        <Eq label={`Energy equals ${fmt(hr.scf / 1e6, 1)} MMcf times ${hhv} Btu per cubic foot, which is ${fmt(hr.mmbtu)} MMBtu`}>
          <K c="energy">E</K>
          <Op>=</Op>
          <span>{fmt(hr.scf / 1e6, 1)} MMcf</span>
          <Op>×</Op>
          <K c="energy">{fmt(hhv)} Btu/scf</K>
          <Op>=</Op>
          <K c="energy">{fmt(hr.mmbtu)} MMBtu</K>
        </Eq>
        <Slider label="Line pressure" tone="blue" value={pressure} min={0} max={NORTHLINE.maopPsig} step={5} onChange={(v) => m.set({ pressure: v })} display={psigFmt(pressure)} />
        <Slider label="Gas temperature" tone="teal" value={temp} min={20} max={100} onChange={(v) => m.set({ temp: v })} display={`${temp} °F`} />
        <Slider label="Heating value" tone="gold" value={hhv} min={950} max={1100} onChange={(v) => m.set({ hhv: v })} display={`${fmt(hhv)} Btu/scf`} />
        <Checkbox label="Flow computer treats the gas as ideal (ignores Z)" checked={ideal} onChange={(v) => m.set({ ideal: v })} />
        {ideal && (
          <Caption>
            Treating the gas as ideal, the flow computer counts {fmt(hr.mmbtu)} MMBtu. The pipe really delivered {fmt(hr.trueMMBtu)}, so {pct(lost / hr.trueMMBtu, 1)} of
            it went uncounted, worth {usd(lost * HUB_PRICE)} this hour.
          </Caption>
        )}
      </Figure>

      <P>
        At the starting settings the gas arrives at {psigFmt(METER_DEFAULTS.pressure)}, Northline’s minimum delivery pressure, and {METER_DEFAULTS.temp} °F.{' '}
        <a href={lessonHref('gas/1.2')}>Lesson 1.2</a> took buried gas to be at 60 °F, but the ground runs cooler in winter and warmer in summer, so a meter station
        measures the temperature rather than assuming it. At these conditions each actual cubic foot holds {fmt(DEF.scfPerCf, 1)} standard cubic feet, so the hour’s million cubic feet are {fmt(DEF.scf / 1e6, 1)} MMcf of gas — about {pct(DEF.scf / 1e6 / NORTHLINE_HOUR_MMCF)} of what Northline carries
        in an hour at its full {NORTHLINE.capacityBcfd} Bcf/d, {fmt(NORTHLINE_HOUR_MMCF)} MMcf. At {fmt(METER_DEFAULTS.hhv)} Btu per standard cubic foot that’s{' '}
        {fmt(DEF.mmbtu)} MMBtu, worth {usd(DEF.mmbtu * HUB_PRICE)} at a simulated price of ${HUB_PRICE.toFixed(2)} per MMBtu.
      </P>
      <P>
        The first equation is the gas law of <a href={lessonHref('gas/1.2')}>Lesson 1.2</a>, rearranged: the same molecules that fill a cubic foot at the line’s
        pressure and temperature would fill {fmt(DEF.scfPerCf, 1)} cubic feet at standard conditions. Raise the pressure and the same reading holds more gas, roughly in
        proportion: at the line’s {psigFmt(NORTHLINE.maopPsig)} limit the hour would be {fmt(AT_MAOP.scf / 1e6, 1)} MMcf, more than twice as much. Cool the gas and it
        holds more too. At {psigFmt(METER_DEFAULTS.pressure)}, the same reading carries {pct(COLD.mmbtu / WARM.mmbtu - 1)} more energy at 30 °F than at 80 °F, so a
        meter that ignored temperature would bill a winter morning and a summer afternoon alike.
      </P>
      <P>
        The last factor is the compressibility of <a href={lessonHref('gas/1.2')}>Lesson 1.2</a>. Tick the box to see what a flow computer that treated the gas as ideal would report. At the starting
        settings it counts {fmt(DEF_IDEAL.mmbtu)} MMBtu, {pct(1 - DEF_IDEAL.mmbtu / DEF.mmbtu)} less than the {fmt(DEF.mmbtu)} that went by: gas worth{' '}
        {usd((DEF.mmbtu - DEF_IDEAL.mmbtu) * HUB_PRICE)} every hour that the flow computer would never record. At pipeline pressures, Z is anything but a rounding error, so measurement standards spell out how to
        calculate it from the gas’s composition, pressure and temperature. At standard conditions themselves, natural gas is ideal to within about a quarter of a
        percent.
      </P>

      <H2>Energy, not volume</H2>
      <P>
        Now move the heating value. The standard volume stays put and the energy moves in proportion: lean gas from Sandhill and rich gas from Ridgeback would fill the
        same cubic feet with different amounts of heat. That is why gas is bought and sold by energy. The trading unit is the MMBtu, a million British thermal units
        (a Btu is about the heat that warms a pound of water by one degree Fahrenheit). Pipeline contracts often say dekatherm instead, which is the same thing: a
        dekatherm is ten <b>therms</b> of 100,000 Btu each, or exactly one MMBtu. Canadian hubs usually quote prices per gigajoule ({fmt(GJ_PER_MMBTU, 3)} GJ to the
        MMBtu), and European hubs per megawatt-hour of gas ({fmt(MMBTU_PER_MWH, 3)} MMBtu to the MWh). The industry’s abbreviations count in Roman numerals, not
        metric prefixes: M is a thousand, so an Mcf is a thousand cubic feet, an MMcf a thousand thousand — a million — and an MMBtu a million Btu. A Bcf, with B for
        billion, is a thousand MMcf.
      </P>
      <P>
        Prices quoted per volume still turn up, and need care. Trading hubs quote dollars per MMBtu, while many statistics, including the US government’s, quote
        dollars per thousand cubic feet. An Mcf of the region’s gas carries {MMBTU_PER_MCF} MMBtu, so ${HUB_PRICE.toFixed(2)} per MMBtu is{' '}
        {usd(HUB_PRICE * MMBTU_PER_MCF, 2)} per Mcf. The two agree only for gas of exactly 1,000 Btu per standard cubic foot.
      </P>
      <P>
        Energy units also connect gas to electricity. A power plant’s <b>heat rate</b> is the MMBtu it burns for every megawatt-hour it makes; the electricity course’s
        Lakeside combined-cycle plant burns {LAKESIDE_HEAT_RATE} (<a href={lessonHref('4.3')}>Lesson 4.3</a> of that course). Since a megawatt-hour is{' '}
        {fmt(MMBTU_PER_MWH, 3)} MMBtu of energy, Lakeside turns {pct(MMBTU_PER_MWH / LAKESIDE_HEAT_RATE)} of the gas’s energy into electricity. We’ll come back to
        that number in Chapter 5, where the price of gas becomes the price of power.
      </P>

      <H2>At the kitchen stove</H2>
      <P>
        The same arithmetic, at a far lower pressure, is on every household gas bill. Homes take gas from the utility’s distribution pipes at only about a quarter of a
        psi above the atmosphere — 7 inches of water column, in the industry’s units — and a home meter counts it in hundreds of cubic feet, written CCF. The utility
        converts CCF to therms with a <b>therm factor</b> that folds in the gas’s heating value and the small pressure correction. At sea level, with the gas at 60 °F,
        a cubic foot at the meter holds {fmt(HOME_SCF_PER_CF, 3)} standard cubic feet. In the next demonstration, set a month’s use and the gas quality. The retail
        price, the same ${RETAIL_PRICE.toFixed(2)} whether it’s charged per CCF or per therm, is illustrative:
      </P>

      <Figure name="Gas Measurement Lab · the household bill" scenario={b}>
        <svg
          className="diagram"
          viewBox="0 0 600 132"
          role="img"
          aria-label={`A household meter reads ${b.state.ccf} CCF this month. With gas of ${b.state.hhv} Btu per standard cubic foot, each CCF is ${fmt(tpc, 3)} therms, so the month is ${fmt(therms, 1)} therms.`}
        >
          <rect x={20} y={16} width={170} height={100} rx={8} fill="#ecebe6" stroke="#555" strokeWidth={1.5} />
          <text x={105} y={38} textAnchor="middle" className="ax">
            home meter, this month
          </text>
          <rect x={44} y={50} width={122} height={36} rx={3} fill="#fff" stroke="#555" strokeWidth={1.2} />
          <text x={105} y={75} textAnchor="middle" style={{ fontSize: 20, fontWeight: 500, fill: '#333', fontVariantNumeric: 'tabular-nums', letterSpacing: 2 }}>
            {String(b.state.ccf).padStart(4, '0')}
          </text>
          <text x={105} y={104} textAnchor="middle" className="ax">
            CCF
          </text>
          <line x1={196} y1={66} x2={392} y2={66} stroke="#9a9a9a" strokeWidth={1.5} />
          <path d="M386 60 L396 66 L386 72" fill="none" stroke="#9a9a9a" strokeWidth={1.5} />
          <text x={294} y={48} textAnchor="middle" className="ax">
            × therm factor
          </text>
          <text x={294} y={88} textAnchor="middle" style={{ fontSize: 15, fontWeight: 500, fill: TEXT.gold }}>
            {fmt(tpc, 3)} therms per CCF
          </text>
          <rect x={402} y={34} width={178} height={64} rx={4} fill={tint(GRAPHIC.gold, 0.25)} stroke="#555" strokeWidth={1.2} />
          <text x={491} y={62} textAnchor="middle" style={{ fontSize: 20, fontWeight: 500, fill: TEXT.gold }}>
            {fmt(therms, 1)}
          </text>
          <text x={491} y={84} textAnchor="middle" className="ax">
            therms billed
          </text>
        </svg>
        <Readouts
          items={[
            { label: `billed by volume, $${RETAIL_PRICE.toFixed(2)} per CCF`, value: usd(byVolume, 2), tone: 'green' },
            { label: `billed by energy, $${RETAIL_PRICE.toFixed(2)} per therm`, value: usd(byEnergy, 2), tone: 'green' },
          ]}
        />
        <DataTable
          caption={`The month’s gas in other units, at ${b.state.hhv} Btu per standard cubic foot`}
          rows={units}
          rowKey={(r) => r.key}
          columns={[
            { label: 'The month’s gas, in', cell: (r) => r.unit },
            { label: 'Amount', cell: (r) => r.value, align: 'right' },
          ]}
        />
        <Slider label="Gas used this month" value={b.state.ccf} min={0} max={250} onChange={(v) => b.set({ ccf: v })} display={`${b.state.ccf} CCF`} />
        <Slider label="Heating value" tone="gold" value={b.state.hhv} min={950} max={1100} onChange={(v) => b.set({ hhv: v })} display={`${fmt(b.state.hhv)} Btu/scf`} />
      </Figure>

      <P>
        A cold month’s {BILL_DEFAULTS.ccf} CCF of the region’s gas is {fmt(DEF_THERMS, 1)} therms: each CCF is {fmt(100 * HOME_SCF_PER_CF, 1)} standard cubic feet at{' '}
        {fmt(BILL_DEFAULTS.hhv)} Btu apiece, or {fmt(DEF_TPC, 3)} therms. Billed by energy, the month costs {usd(DEF_THERMS * RETAIL_PRICE, 2)}; billed by volume at the
        same rate, {usd(BILL_DEFAULTS.ccf * RETAIL_PRICE, 2)}. Change the month’s use and every number in the demonstration scales with it, but the therm factor
        doesn’t: it depends only on the gas, so billing the region’s gas by energy raises a small bill and a large one by the same {pct(DEF_TPC - 1, 1)}. Notice, too,
        how far the retail price sits from the wholesale one. ${RETAIL_PRICE.toFixed(2)} a therm is $
        {fmt(RETAIL_PRICE * 10, 2)} per MMBtu, against the simulated ${HUB_PRICE.toFixed(2)} hub price of{' '}
        <FigRef to="Gas Measurement Lab">the first demonstration</FigRef>. At these illustrative prices the gas itself is less than a quarter of the bill; the rest
        pays for the local pipes, meters and service that bring it to the house.
      </P>

      <Challenge
        id="a"
        question={`Suppose a utility charged $${RETAIL_PRICE.toFixed(2)} per CCF and switched to $${RETAIL_PRICE.toFixed(2)} per therm. For what gas quality would no customer’s bill change? A CCF at the meter is ${fmt(100 * HOME_SCF_PER_CF, 1)} standard cubic feet and a therm is 100,000 Btu: work out the heating value first, to the nearest Btu per standard cubic foot, then set it to check.`}
        solved={solved}
        status={
          b.state.hhv === BILL_DEFAULTS.hhv
            ? 'Work out the heating value first, then set it.'
            : `At ${fmt(b.state.hhv)} Btu/scf, a CCF is ${fmt(tpc, 3)} therms.`
        }
        success={`Solved: ${CCF_THERM_HHV} Btu per standard cubic foot. The bills match when one CCF is one therm, so ${fmt(100 * HOME_SCF_PER_CF, 1)} standard cubic feet must carry 100,000 Btu: 100,000 ÷ ${fmt(100 * HOME_SCF_PER_CF, 1)} ≈ ${CCF_THERM_HHV}. That’s a little under 1,000, because the meter’s cubic feet are slightly compressed. Richer gas makes a bill by the therm higher than one by the CCF, and leaner gas makes it lower: per therm, the customer pays for what the gas actually does.`}
      />

      <H2>Counting gas from here on</H2>
      <P>
        Physical flows are reported by volume and markets settle in energy, so the rest of the course uses both, the way the industry does. From Chapter 3 on we’ll
        count gas in standard volumes — Bcf, and Bcf per day for flows — and price it in dollars per MMBtu, converting with the region’s {fmt(METER_DEFAULTS.hhv)} Btu
        per standard cubic foot: one Mcf is {MMBTU_PER_MCF} MMBtu, and one Bcf is {MMBTU_PER_MCF} million MMBtu. Northline’s {NORTHLINE.capacityBcfd} Bcf/d is
        then {fmt(NORTHLINE_DAY_MMBTU)} MMBtu a day, worth about ${fmt((NORTHLINE_DAY_MMBTU * HUB_PRICE) / 1e6, 1)} million at ${HUB_PRICE.toFixed(2)}. All prices in
        the course are simulated.
      </P>
      <P>
        That answers the chapter’s question. Composition sets the energy in a cubic foot; pressure and temperature set how many cubic feet fit in a space; diameter
        and the difference of squared pressures set how much a pipe can carry; compressors buy distance with fuel; and a meter, with the gas law and a
        chromatograph, turns all of it back into energy. None of it says where the gas comes from. In <a href={lessonHref('gas/2.1')}>Chapter 2</a> we go underground,
        starting with the rock that holds gas and the properties that decide how much of it can be brought to the surface.
      </P>
    </LessonPage>
  );
}
