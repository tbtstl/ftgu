import type { KeyboardEvent } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  Figure,
  Frac,
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
  fmt,
  lessonHref,
  pct,
  useScenario,
} from '../../framework';
import { lineLoss } from '../../engines/physics/losses';
import { findIslands } from '../../engines/physics/powerflow';
import { REGION, nodeName } from '../../model/networks';
import { LINE_STYLE, RegionMap } from '../shared/RegionMap';
import { energizeFeeders, type FeederSection, type FeederSource, type FeederSwitch } from '../../engines/ops/feeder';

// ---------------------------------------------------------------------------------------------
// The path from Lakeside to ten homes in Metro. Illustrative conductors: each stage keeps its own
// wire whatever voltage it runs at, so the figure isolates the effect of voltage.

const GEN_KV = 20;
const TX = { mw: 300, km: 100, ohmPerKm: 0.03 };
const FEEDER = { mw: 5, km: 3, ohmPerKm: 0.3 };
const SERVICE = { mw: 0.024, km: 0.04, ohmPerKm: 0.5 };

type TxKV = '69' | '138' | '230' | '345' | '500';
type FeederKV = '4.16' | '13.8' | '34.5';

export function chain(txKV: number, circuits: number, feederKV: number) {
  const n = Math.max(1, Math.round(circuits));
  const one = lineLoss({ sendMW: TX.mw / n, kV: txKV, lengthKm: TX.km, ohmPerKm: TX.ohmPerKm });
  const tx = { amps: one.amps, lossMW: one.lossMW * n, share: (one.lossMW * n) / TX.mw };
  const fd = lineLoss({ sendMW: FEEDER.mw, kV: feederKV, lengthKm: FEEDER.km, ohmPerKm: FEEDER.ohmPerKm });
  const sv = lineLoss({ sendMW: SERVICE.mw, kV: 0.24, lengthKm: SERVICE.km, ohmPerKm: SERVICE.ohmPerKm, threePhase: false });
  const delivered = (1 - tx.share) * (1 - fd.lossShare) * (1 - sv.lossShare);
  return { n, tx, fd, sv, delivered, genAmps: (TX.mw * 1e6) / (Math.sqrt(3) * GEN_KV * 1e3) };
}

/** Fewest 138 kV circuits that bring the transmission loss under 1%. */
export const CIRCUITS_AT_138 = (() => {
  for (let n = 1; n <= 6; n++) if (chain(138, n, 13.8).tx.share < 0.01) return n;
  return -1;
})();

/** The circuits challenge: the line at 138 kV, on the fewest circuits that keep its losses under 1%. */
export function circuitsSolved(s: { txKV: string; circuits: number }): boolean {
  return s.txKV === '138' && s.circuits === CIRCUITS_AT_138;
}

/** The Grid Constructor's opening settings: the region's actual voltages, on one circuit. */
export const CHAIN_DEFAULTS = { txKV: '345' as TxKV, circuits: 1, feederKV: '13.8' as FeederKV };

// ---------------------------------------------------------------------------------------------
// The region's transmission grid on the map: which substations are still connected.

/** Substations cut off from the largest connected piece of the grid when `out` lines are out of service. */
export function cutOff(out: string[]): string[] {
  const islands = findIslands(REGION, out);
  const main = islands.reduce((a, b) => (b.length > a.length ? b : a));
  return islands.filter((g) => g !== main).flat();
}

// ---------------------------------------------------------------------------------------------
// Two radial feeders out of the Metro substation, four sections each, with a tie between their ends.

export const SECTIONS: FeederSection[] = [
  { id: 'F1-1', customers: 620 },
  { id: 'F1-2', customers: 480 },
  { id: 'F1-3', customers: 530 },
  { id: 'F1-4', customers: 370 },
  { id: 'F2-1', customers: 540 },
  { id: 'F2-2', customers: 610 },
  { id: 'F2-3', customers: 450 },
  { id: 'F2-4', customers: 400 },
];
const NORMAL: FeederSwitch[] = [
  { id: 'S1a', a: 'F1-1', b: 'F1-2', closed: true },
  { id: 'S1b', a: 'F1-2', b: 'F1-3', closed: true },
  { id: 'S1c', a: 'F1-3', b: 'F1-4', closed: true },
  { id: 'S2a', a: 'F2-1', b: 'F2-2', closed: true },
  { id: 'S2b', a: 'F2-2', b: 'F2-3', closed: true },
  { id: 'S2c', a: 'F2-3', b: 'F2-4', closed: true },
  { id: 'TIE', a: 'F1-4', b: 'F2-4', closed: false },
];
const TX_LINES = [
  { id: 'center-city', from: 'Central', kV: 345, x: 55 },
  { id: 'east-city', from: 'East', kV: 230, x: 100 },
  { id: 'west-city', from: 'West', kV: 230, x: 145 },
];
const TOTAL_CUSTOMERS = SECTIONS.reduce((s, x) => s + x.customers, 0);

export interface FeederFigureState {
  /** Transmission lines into Metro that are out of service. */
  out: string[];
  /** Faulted sections. */
  faults: string[];
  /** Switches the reader has flipped from their normal position. */
  flipped: string[];
}

export function feederState(s: FeederFigureState) {
  const switches = NORMAL.map((sw) => ({ ...sw, closed: s.flipped.includes(sw.id) ? !sw.closed : sw.closed }));
  const live = TX_LINES.some((l) => !s.out.includes(l.id));
  const sources: FeederSource[] = [
    { id: 'B1', section: 'F1-1', live },
    { id: 'B2', section: 'F2-1', live },
  ];
  const result = energizeFeeders(SECTIONS, switches, sources, s.faults);
  return { switches, live, sources, ...result };
}

export function restorationSolved(s: FeederFigureState): boolean {
  const r = feederState(s);
  return s.faults.includes('F1-2') && r.energized.length === SECTIONS.length - s.faults.length;
}

// Layout of the feeder drawing.
const SEC_X = [212, 316, 420, 524];
const SEC_W = 84;
const FEEDER_Y: Record<string, number> = { F1: 150, F2: 268 };
const TIE_X = 626;
const switchPos = (id: string): [number, number] => {
  if (id === 'TIE') return [TIE_X, 209];
  const f = id[1] === '1' ? 'F1' : 'F2';
  const k = 'abc'.indexOf(id[2]);
  return [SEC_X[k] + SEC_W + 10, FEEDER_Y[f]];
};

function onKey(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function House({ x, y, lit }: { x: number; y: number; lit: boolean }) {
  return <path d={`M${x - 7} ${y} L${x - 7} ${y - 9} L${x} ${y - 15} L${x + 7} ${y - 9} L${x + 7} ${y} Z`} fill={lit ? '#f6c453' : '#e2e2e2'} stroke="#777" strokeWidth={1} />;
}

/** Transformer symbol: two overlapping circles on a horizontal line at (x, y). */
function Xfmr({ x, y, r = 11 }: { x: number; y: number; r?: number }) {
  return (
    <g fill="#fcfcfb" stroke="#555" strokeWidth={1.8}>
      <circle cx={x - r * 0.6} cy={y} r={r} />
      <circle cx={x + r * 0.6} cy={y} r={r} />
    </g>
  );
}

/** "118 kW" below a megawatt, "1.30 MW" above. */
function kwOrMw(mwLost: number): string {
  return mwLost >= 1 ? `${fmt(mwLost, 2)} MW` : `${fmt(mwLost * 1000)} kW`;
}

function dots(amps: number) {
  const speed = 8 + 10 * Math.log10(1 + amps);
  return { animationDuration: `${(18 / speed).toFixed(3)}s` };
}

export default function Lesson() {
  const s1 = useScenario('chain', CHAIN_DEFAULTS);
  const c = chain(Number(s1.state.txKV), s1.state.circuits, Number(s1.state.feederKV));
  const solved1 = circuitsSolved(s1.state);

  const sMap = useScenario('network', { out: [] as string[] });
  const cut = cutOff(sMap.state.out);
  const toggleMapLine = (id: string) => sMap.set((p) => ({ out: toggle(p.out, id) }));
  let mapCaption: string;
  if (cut.length) mapCaption = `${cut.map((id) => nodeName(REGION, id)).join(' and ')} ${cut.length > 1 ? 'are' : 'is'} cut off from the rest of the grid.`;
  else if (sMap.state.out.length)
    mapCaption = `With ${sMap.state.out.length} line${sMap.state.out.length > 1 ? 's' : ''} out, every substation is still connected to every other: the power has another way round.`;
  else mapCaption = 'Every substation is joined to the grid by at least two lines.';

  const s2 = useScenario<FeederFigureState>('feeders', { out: [], faults: ['F1-2'], flipped: [] });
  const fs = feederState(s2.state);
  const on = new Set(fs.energized);
  const solved2 = restorationSolved(s2.state);

  // Which way power runs along each energized section: from the breaker, or back through the tie.
  const closed = new Set(fs.switches.filter((w) => w.closed).map((w) => w.id));
  const feedDir: Record<string, 1 | -1> = {};
  for (const src of fs.sources) {
    if (!src.live || fs.tripped.includes(src.id)) continue;
    const queue: Array<[string, 1 | -1]> = [[src.section, 1]];
    const seen = new Set<string>([src.section]);
    while (queue.length) {
      const [id, dir] = queue.shift()!;
      feedDir[id] = dir;
      for (const w of fs.switches) {
        if (!closed.has(w.id) || (w.a !== id && w.b !== id)) continue;
        const other = w.a === id ? w.b : w.a;
        if (seen.has(other) || s2.state.faults.includes(other)) continue;
        seen.add(other);
        const sameFeeder = other.slice(0, 2) === id.slice(0, 2);
        queue.push([other, sameFeeder ? (Number(other[3]) > Number(id[3]) ? 1 : -1) : -1]);
      }
    }
  }
  const tieLive = closed.has('TIE') && on.has('F1-4') && on.has('F2-4');

  let caption: string;
  const onFaulted = s2.state.faults.reduce((t, id) => t + (SECTIONS.find((x) => x.id === id)?.customers ?? 0), 0);
  if (!fs.live) caption = 'With all three transmission lines out, the substation itself has lost supply, and every customer on both feeders is in the dark.';
  else if (fs.tripped.length === 2) caption = 'Both breakers have tripped: a fault is connected to both feeders at once, so every customer on them has lost power.';
  else if (fs.tripped.length === 1)
    caption = `The fault tripped ${fs.tripped[0] === 'B1' ? 'Feeder 1' : 'Feeder 2'}’s breaker at the substation, so every customer on that feeder has lost power — even those nowhere near the fault.`;
  else if (fs.customersOff === 0) caption = 'Every customer has power.';
  else if (s2.state.faults.length)
    caption =
      fs.customersOff === onFaulted
        ? `The fault is isolated, and the only customers without power are the ${fmt(onFaulted)} on the faulted section${s2.state.faults.length > 1 ? 's themselves' : ' itself'}.`
        : `The fault is isolated from the breakers, but ${fmt(fs.customersOff)} customers are still without power.`;
  else caption = `${fmt(fs.customersOff)} customers are cut off from both breakers by open switches.`;

  return (
    <LessonPage id="2.2">
      <P>
        The power plants of the previous lesson sit where their fuel, water, wind or sunshine is. Most of the customers are in Metro. In between lie hundreds of kilometers
        of wire, and <a href={lessonHref('1.5')}>Lesson 1.5</a> showed what that wire costs: the power lost in a line grows with the square of the{' '}
        <K c="current">current</K> it carries, and for a given power, the current falls as the <K c="voltage">voltage</K> rises. Long distances call for high voltages.
      </P>
      <P>
        But nobody wants 345,000 volts in their kitchen, so the grid is built in stages. A generator produces power at around 20 kV. A transformer beside the plant steps
        it up to transmission voltage — in North America, usually somewhere between 115 and 765 kV — for the long journey. Substations near the customers step it down to
        distribution voltage, typically between about 4 and 35 kV, and feeders carry it along streets. Finally a small transformer on a pole or a pad, within a few houses
        of each customer, steps it down once more to the 240 volts, split into two 120-volt halves, that enter a North American home.
      </P>
      <P>
        Here is one path through our region. Lakeside sends 300 MW over the 100 km line from Central to Metro. One of Metro’s distribution feeders carries 5 MW about 3 km
        out into a neighborhood, and a service transformer feeds ten homes, each drawing 2.4 kW at the evening peak, over 40 m of low-voltage cable. Each stage keeps its own
        conductor whatever voltage you choose, so only the voltage changes. Pick a voltage for the transmission line and for the feeder, and set how many parallel
        circuits share the transmission line’s 300 MW:
      </P>

      <Figure name="Grid Constructor" scenario={s1}>
        <Segmented
          label="Transmission voltage"
          value={s1.state.txKV}
          onChange={(v) => s1.set({ txKV: v })}
          options={(['69', '138', '230', '345', '500'] as TxKV[]).map((v) => ({ value: v, label: `${v} kV` }))}
        />
        <Segmented
          label="Distribution feeder voltage"
          value={s1.state.feederKV}
          onChange={(v) => s1.set({ feederKV: v })}
          options={(['4.16', '13.8', '34.5'] as FeederKV[]).map((v) => ({ value: v, label: `${v} kV feeder` }))}
        />
        <svg
          className="diagram"
          viewBox="0 0 640 230"
          role="img"
          aria-label={`Lakeside to ten homes: transmission at ${s1.state.txKV} kV on ${c.n} circuit${c.n > 1 ? 's' : ''} loses ${pct(c.tx.share, 2)}; the ${s1.state.feederKV} kV feeder loses ${pct(c.fd.lossShare, 2)}; the 240 V service loses ${pct(c.sv.lossShare, 2)}. ${pct(c.delivered, 1)} of the power reaches the homes.`}
        >
          {/* stage names */}
          <text className="ax ax-m" x={44} y={40}>
            Lakeside
          </text>
          <text className="ax ax-m" x={226} y={40}>
            transmission · 100 km
          </text>
          <text className="ax ax-m" x={432} y={40}>
            feeder · 3 km
          </text>
          <text className="ax ax-m" x={590} y={40}>
            service · 40 m
          </text>
          {/* voltages */}
          {[
            [44, `${GEN_KV} kV`],
            [226, `${s1.state.txKV} kV`],
            [432, `${s1.state.feederKV} kV`],
            [590, '240 V'],
          ].map(([xx, t]) => (
            <text key={String(xx)} x={Number(xx)} y={62} textAnchor="middle" style={{ fontSize: 15, fontWeight: 500, fill: '#2f6fb3' }}>
              {t}
            </text>
          ))}
          {/* generator */}
          <circle cx={44} cy={118} r={20} fill="#fcfcfb" stroke="#555" strokeWidth={1.8} />
          <path d="M32 118 C36 108, 40 108, 44 118 S52 128, 56 118" fill="none" stroke="#555" strokeWidth={1.8} />
          <line x1={64} y1={118} x2={86} y2={118} stroke="#9a9a9a" strokeWidth={4} />
          <Xfmr x={100} y={118} />
          {/* transmission circuits */}
          {Array.from({ length: c.n }, (_, i) => {
            const yy = 118 + (i - (c.n - 1) / 2) * 9;
            return (
              <g key={i}>
                <path d={`M114 118 L126 ${yy} L326 ${yy} L338 118`} fill="none" stroke="#9a9a9a" strokeWidth={4} strokeLinejoin="round" />
                <path d={`M126 ${yy} L326 ${yy}`} className="flow-dots" stroke="#fff" strokeWidth={3} style={dots(c.tx.amps)} />
              </g>
            );
          })}
          <Xfmr x={352} y={118} />
          <text className="ax ax-m" x={352} y={166}>
            Metro substation
          </text>
          {/* feeder */}
          <line x1={366} y1={118} x2={500} y2={118} stroke="#9a9a9a" strokeWidth={4} />
          <path d="M370 118 L496 118" className="flow-dots" stroke="#fff" strokeWidth={3} style={dots(c.fd.amps)} />
          <Xfmr x={512} y={118} r={8} />
          {/* service */}
          <line x1={522} y1={118} x2={634} y2={118} stroke="#9a9a9a" strokeWidth={3} />
          <path d="M526 118 L630 118" className="flow-dots" stroke="#fff" strokeWidth={2.5} style={dots(c.sv.amps)} />
          {[556, 590, 624].map((hx) => (
            <g key={hx}>
              <line x1={hx} y1={118} x2={hx} y2={132} stroke="#9a9a9a" strokeWidth={2} />
              <House x={hx} y={150} lit />
            </g>
          ))}
          {/* currents and losses */}
          {[
            [44, `${fmt(c.genAmps)} A`, ''],
            [226, `${fmt(c.tx.amps)} A${c.n > 1 ? ` × ${c.n}` : ''}`, `${fmt(c.tx.lossMW, 1)} MW lost`],
            [432, `${fmt(c.fd.amps)} A`, `${kwOrMw(c.fd.lossMW)} lost`],
            [590, `${fmt(c.sv.amps)} A`, `${fmt(c.sv.lossMW * 1e6)} W lost`],
          ].map(([xx, a, l]) => (
            <g key={String(xx)}>
              <text x={Number(xx)} y={186} textAnchor="middle" style={{ fontSize: 14, fontWeight: 500, fill: '#ad5310' }}>
                {a}
              </text>
              <text x={Number(xx)} y={206} textAnchor="middle" style={{ fontSize: 14, fontWeight: 500, fill: '#c4382f' }}>
                {l}
              </text>
            </g>
          ))}
          <text className="ax ax-e" x={636} y={226}>
            not to scale
          </text>
        </svg>
        <Slider
          label="Parallel transmission circuits"
          value={s1.state.circuits}
          min={1}
          max={6}
          onChange={(v) => s1.set({ circuits: v })}
          display={`${s1.state.circuits} circuit${s1.state.circuits > 1 ? 's' : ''}`}
        />
        <Readouts
          items={[
            { label: 'lost in transmission', value: pct(c.tx.share, 2), tone: 'red' },
            { label: 'lost in the feeder', value: pct(c.fd.lossShare, 2), tone: 'red' },
            { label: 'lost in the service cable', value: pct(c.sv.lossShare, 2), tone: 'red' },
            { label: 'reaches the homes', value: pct(c.delivered, 1) },
          ]}
        />
      </Figure>

      <P>
        At the voltages our region actually uses — 345 kV for the line and 13.8 kV for the feeder — the transmission line loses 0.76% of what it carries, the feeder 2.4% and the
        service cable 1.7%, and 95.3% of Lakeside’s output reaches the homes. The feeder loses three times the share the transmission line does, over a thirtieth of the
        distance. To see why, take the current in each conductor from <a href={lessonHref('1.5')}>Lesson 1.5</a>, <K c="power">P</K> ÷ (√3 × <K c="voltage">V</K>),
        work out the loss in all three conductors, 3 <K c="current">I</K>
        <Sup>2</Sup>
        <K c="resistance">R</K>, and divide by the power sent. The √3s cancel, and what’s left is simple:
      </P>
      <Eq label="Share of the power lost">
        <Frac
          top={
            <K c="power">
              P<Sub>loss</Sub>
            </K>
          }
          bottom={<K c="power">P</K>}
        />
        <Op>=</Op>
        <Frac
          top={
            <>
              <K c="power">P</K> <K c="resistance">R</K>
            </>
          }
          bottom={
            <>
              <K c="voltage">V</K>
              <Sup>2</Sup>
            </>
          }
        />
      </Eq>
      <P>
        The feeder’s voltage is twenty-five times lower, which on its own would make its share 625 times larger. But it carries a sixtieth of the power, 5 MW against 300,
        and its 3 km of wire has under a third of the line’s resistance, 0.9 ohms against 3. Together those bring the ratio down to about three. Drop the transmission line
        to 69 kV and its voltage falls fivefold, so its share of losses rises twenty-five-fold, to 19% of everything it carries. Drop the feeder to 4.16 kV and it loses a
        quarter of its power.
      </P>
      <P>
        Why not use high voltage everywhere, then? Because insulating it is expensive. A 345 kV line needs its conductors several meters apart, hung from tall towers on a
        wide strip of cleared land, and every transformer and switch connected to it must hold off that voltage too. That expense is worth it for hundreds of megawatts
        traveling a hundred kilometers, but not for a few megawatts running down a street lined with trees. Each stage’s voltage is a compromise between the cost of losses
        and the cost of insulation.
      </P>
      <P>
        There’s a second way to cut losses: split the current. Two identical circuits in parallel each carry half the current, so each loses a quarter as much, and
        together they lose half as much as one circuit would:
      </P>
      <Eq label="Losses on n parallel circuits">
        <K c="power">
          P<Sub>loss</Sub>
        </K>
        <Op>=</Op>
        <span>n</span>
        <Op>×</Op>
        <Op>(</Op>
        <Frac top={<K c="current">I</K>} bottom="n" />
        <Op>)</Op>
        <Sup>2</Sup>
        <K c="resistance">R</K>
        <Op>=</Op>
        <Frac
          top={
            <>
              <K c="current">I</K>
              <Sup>2</Sup>
              <K c="resistance">R</K>
            </>
          }
          bottom="n"
        />
      </Eq>
      <Challenge
        id="a"
        question={`Suppose the line from Central to Metro could only be built at 138 kV, 2.5 times lower than today’s 345 kV. At 345 kV, one circuit loses ${pct(chain(345, 1, 13.8).tx.share, 2)}. Use the two formulas to predict the fewest parallel circuits that would keep the losses at 138 kV below 1%, then set them to check.`}
        solved={solved1}
        status={
          s1.state.txKV !== '138'
            ? 'Set the transmission voltage to 138 kV first.'
            : `With ${c.n} circuit${c.n > 1 ? 's' : ''} at 138 kV, the line loses ${pct(c.tx.share, 2)}.`
        }
        success={`Solved. At 138 kV a single circuit loses 2.5² = 6.25 times the share it would at 345 kV, ${pct(chain(138, 1, 13.8).tx.share, 2)}, and splitting the current over n circuits divides that by n: it takes ${CIRCUITS_AT_138} to get under 1%, at ${pct(chain(138, CIRCUITS_AT_138, 13.8).tx.share, 2)}. Raising the voltage 2.5 times does more than four extra circuits.`}
      />

      <H2>Meshed and radial</H2>
      <P>
        Voltage isn’t the only difference between the stages. The transmission grid is <b>meshed</b>: its lines form loops, so there’s more than one path between any two
        substations. The next demonstration draws our region’s transmission grid over the map of <a href={lessonHref('2.1')}>Lesson 2.1</a>: six substations — North,
        East, Central, Harbor, West and Metro — joined by eight lines, the thicker ones at 345 kV and the thinner at 230 kV. Metro, where most of the customers are, is fed
        by three of them: a 345 kV line from Central, and 230 kV lines from East and from West. Click a line to take it out of service:
      </P>

      <Figure name="Grid Constructor · the transmission grid" scenario={sMap}>
        <Legend
          items={[
            { label: '345 kV line', color: LINE_STYLE[345].color, kind: 'line' as const },
            { label: '230 kV line', color: LINE_STYLE[230].color, kind: 'line' as const },
            { label: 'Substation', color: '#4a4a4a' },
          ]}
        />
        <RegionMap network={{ out: sMap.state.out, onToggle: toggleMapLine }} />
        <Caption>{mapCaption}</Caption>
      </Figure>

      <P>
        Take any one line out and every substation is still connected to every other: the power simply goes another way round. It takes two outages to cut off North,
        East or Harbor, each joined to the grid by two lines, and no two outages can cut off Metro. That redundancy is what a meshed grid is for, and where the power
        actually goes when it has several ways round is the subject of <a href={lessonHref('2.4')}>Lesson 2.4</a>.
      </P>
      <P>
        Distribution is almost always <b>radial</b>. Each feeder leaves its substation through a circuit breaker and branches outward like a tree, with exactly one path
        from the substation to each customer. Radial feeders are cheap to build and simple to protect, and most homes and businesses sit somewhere along one. The
        price is fragility. In the next demonstration, the Metro substation feeds two feeders of four sections each, serving 4,000 customers between them. Switches between the sections
        normally stay closed; a <b>tie switch</b> between the far ends of the two feeders normally stays open. A <b>fault</b> is an accidental path for current — a branch
        fallen across the wires, a failed cable — and it draws an enormous current. Click a transmission line to take it out of service, a section to place or clear a
        fault, and a switch to open or close it:
      </P>

      <Figure name="Grid Constructor · when something breaks" scenario={s2}>
        <svg
          className="diagram"
          viewBox="0 0 640 344"
          role="img"
          aria-label={`Two radial feeders from the Metro substation. ${fmt(fs.customersOn)} of ${fmt(TOTAL_CUSTOMERS)} customers have power. Faults: ${s2.state.faults.join(', ') || 'none'}. Transmission lines out: ${s2.state.out.length}.`}
        >
          {/* transmission lines into the substation */}
          {TX_LINES.map((l) => {
            const isOut = s2.state.out.includes(l.id);
            const flip = () => s2.set({ out: toggle(s2.state.out, l.id) });
            return (
              <g
                key={l.id}
                role="button"
                tabIndex={0}
                aria-label={`${l.from}–Metro ${l.kV} kV line: ${isOut ? 'out of service' : 'in service'}. Toggle.`}
                onClick={flip}
                onKeyDown={onKey(flip)}
                style={{ cursor: 'pointer' }}
              >
                <line x1={l.x} y1={40} x2={l.x} y2={110} stroke="transparent" strokeWidth={26} />
                <line x1={l.x} y1={40} x2={l.x} y2={110} stroke={isOut ? '#d6d6d6' : '#9a9a9a'} strokeWidth={isOut ? 4 : 8} strokeDasharray={isOut ? '6 8' : undefined} strokeLinecap="round" />
                {!isOut && fs.live && <path d={`M${l.x} 40 L${l.x} 110`} className="flow-dots" stroke="#fff" strokeWidth={4} style={{ animationDuration: '0.6s' }} />}
                <text className="lab" x={l.x} y={20} textAnchor="middle">
                  {l.from}
                </text>
                <text className="ax ax-m" x={l.x} y={34}>
                  {isOut ? 'out' : `${l.kV} kV`}
                </text>
              </g>
            );
          })}
          <rect x={30} y={110} width={140} height={60} rx={6} fill={fs.live ? '#fff' : '#f1f1f1'} stroke="#555" strokeWidth={1.5} strokeDasharray={fs.live ? undefined : '4 4'} />
          <text className="lab" x={100} y={136} textAnchor="middle">
            Metro substation
          </text>
          <text className="ax ax-m" x={100} y={154}>
            steps down to 13.8 kV
          </text>
          {/* feeders */}
          {(['F1', 'F2'] as const).map((f, fi) => {
            const y0 = FEEDER_Y[f];
            const brk = fi === 0 ? 'B1' : 'B2';
            const tripped = fs.tripped.includes(brk);
            const headLive = fs.live && !tripped;
            const lead = fi === 0 ? `M170 ${y0} L186 ${y0}` : `M100 170 L100 ${y0} L186 ${y0}`;
            return (
              <g key={f}>
                <path d={lead} fill="none" stroke={fs.live ? '#9a9a9a' : '#d6d6d6'} strokeWidth={6} strokeLinejoin="round" />
                <line x1={202} y1={y0} x2={212} y2={y0} stroke={headLive ? '#9a9a9a' : '#d6d6d6'} strokeWidth={6} />
                <rect x={186} y={y0 - 8} width={16} height={16} fill={tripped ? '#fff' : '#444'} stroke={tripped ? '#c4382f' : '#444'} strokeWidth={2} />
                <text className="lab" x={212} y={y0 - 22}>
                  Feeder {fi + 1}
                </text>
                {tripped && (
                  <text x={194} y={y0 + 26} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: '#c4382f' }}>
                    tripped
                  </text>
                )}
                {[0, 1, 2, 3].map((k) => {
                  const id = `${f}-${k + 1}`;
                  const sec = SECTIONS.find((x) => x.id === id)!;
                  const lit = on.has(id);
                  const faulted = s2.state.faults.includes(id);
                  const x0 = SEC_X[k];
                  const dir = feedDir[id] ?? 1;
                  const flip = () => s2.set({ faults: toggle(s2.state.faults, id) });
                  return (
                    <g
                      key={id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Feeder ${fi + 1}, section ${k + 1}, ${sec.customers} customers: ${faulted ? 'faulted' : lit ? 'energized' : 'without power'}. Toggle fault.`}
                      onClick={flip}
                      onKeyDown={onKey(flip)}
                      style={{ cursor: 'pointer' }}
                    >
                      <rect x={x0} y={y0 - 16} width={SEC_W} height={56} fill="transparent" />
                      <line
                        x1={x0}
                        y1={y0}
                        x2={x0 + SEC_W}
                        y2={y0}
                        stroke={faulted ? '#e75b55' : lit ? '#9a9a9a' : '#d6d6d6'}
                        strokeWidth={lit || faulted ? 6 : 4}
                        strokeDasharray={!lit && !faulted ? '6 7' : undefined}
                      />
                      {lit && (
                        <path
                          d={dir > 0 ? `M${x0 + 2} ${y0} L${x0 + SEC_W - 2} ${y0}` : `M${x0 + SEC_W - 2} ${y0} L${x0 + 2} ${y0}`}
                          className="flow-dots"
                          stroke="#fff"
                          strokeWidth={3.5}
                          style={{ animationDuration: '0.9s' }}
                        />
                      )}
                      {faulted && (
                        <path
                          d={`M${x0 + SEC_W / 2 + 3} ${y0 - 20} L${x0 + SEC_W / 2 - 7} ${y0 + 2} L${x0 + SEC_W / 2 - 1} ${y0 + 2} L${x0 + SEC_W / 2 - 4} ${y0 + 20} L${x0 + SEC_W / 2 + 7} ${y0 - 3} L${x0 + SEC_W / 2 + 1} ${y0 - 3} Z`}
                          fill="#c4382f"
                          stroke="#fcfcfb"
                          strokeWidth={1}
                          strokeLinejoin="round"
                        />
                      )}
                      {[0.25, 0.5, 0.75].map((t) => (
                        <House key={t} x={x0 + SEC_W * t} y={y0 + 30} lit={lit} />
                      ))}
                      <text className="ax ax-m" x={x0 + SEC_W / 2} y={y0 + 46}>
                        {sec.customers}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
          {/* tie */}
          <line x1={TIE_X - 18} y1={FEEDER_Y.F1} x2={TIE_X} y2={FEEDER_Y.F1} stroke={on.has('F1-4') ? '#9a9a9a' : '#d6d6d6'} strokeWidth={5} />
          <line x1={TIE_X - 18} y1={FEEDER_Y.F2} x2={TIE_X} y2={FEEDER_Y.F2} stroke={on.has('F2-4') ? '#9a9a9a' : '#d6d6d6'} strokeWidth={5} />
          <line x1={TIE_X} y1={FEEDER_Y.F1} x2={TIE_X} y2={FEEDER_Y.F2} stroke={tieLive ? '#9a9a9a' : '#d6d6d6'} strokeWidth={5} strokeDasharray={closed.has('TIE') ? undefined : '6 7'} />
          <text className="ax" x={TIE_X - 10} y={213} textAnchor="end">
            tie
          </text>
          {/* switches */}
          {fs.switches.map((w) => {
            const [sx, sy] = switchPos(w.id);
            const flip = () => s2.set({ flipped: toggle(s2.state.flipped, w.id) });
            return (
              <g
                key={w.id}
                role="button"
                tabIndex={0}
                aria-label={`${w.id === 'TIE' ? 'Tie switch' : 'Switch'} between ${w.a} and ${w.b}: ${w.closed ? 'closed' : 'open'}. Toggle.`}
                onClick={flip}
                onKeyDown={onKey(flip)}
                style={{ cursor: 'pointer' }}
              >
                <circle cx={sx} cy={sy} r={16} fill="transparent" />
                {w.id !== 'TIE' && <line x1={sx - 10} y1={sy} x2={sx + 10} y2={sy} stroke={w.closed && on.has(w.a) && on.has(w.b) ? '#9a9a9a' : '#d6d6d6'} strokeWidth={5} />}
                <circle cx={sx} cy={sy} r={7.5} fill={w.closed ? '#444' : '#fff'} stroke="#444" strokeWidth={2} />
              </g>
            );
          })}
          <text className="ax" x={30} y={340}>
            ● closed switch · ○ open switch · ■ breaker · numbers: customers on each section
          </text>
        </svg>
        <Readouts items={[{ label: `customers without power, of ${fmt(TOTAL_CUSTOMERS)}`, value: fmt(fs.customersOff), tone: fs.customersOff > 0 ? 'red' : undefined }]} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        The three transmission lines at the top of the drawing are the substation’s links to the mesh. Take any one of them out, or even two, and nobody on the feeders
        notices: the substation is still connected to the grid through the others. Whether the remaining lines can carry Metro’s whole demand is another question, which
        we’ll take up in <a href={lessonHref('2.5')}>Lesson 2.5</a>, but no customer is disconnected.
      </P>
      <P>
        The feeder is a different story. When a fault strikes, the breaker at the head of the feeder opens to stop its enormous current. In our simple feeder that
        breaker is the only protection, so it takes all 2,000 customers on Feeder 1 off with it; real feeders add
        fuses and reclosers farther out to limit the damage. Restoring them is a matter of
        isolating the fault: open the switches on either side of the faulted section, and the breaker can close again onto the healthy sections upstream. The sections
        beyond the fault can then be fed backwards from the neighboring feeder, through the tie. Crews do this by hand, and on feeders with automated switches it can happen
        within a minute or so.
      </P>
      <Challenge
        id="b"
        question="A branch has fallen across section 2 of Feeder 1. Restore power to every customer except those on the faulted section."
        solved={solved2}
        status={
          s2.state.faults.includes('F1-2')
            ? `${fmt(fs.customersOff)} customers are without power, ${fmt(Math.max(0, fs.customersOff - 480))} more than the 480 on the faulted section.`
            : 'Put the fault back on section 2 of Feeder 1: a real fault doesn’t clear itself.'
        }
        success="Solved. Opening the switches on both sides of section 2 lets Feeder 1’s breaker close onto section 1, and closing the tie feeds sections 3 and 4 from Feeder 2. Close the tie before isolating the fault, and both breakers trip."
      />
      <P>
        Partly because of this radial design, most of the power cuts customers experience start on the distribution system rather than on the transmission grid, which
        is why utilities spend so much effort on tree trimming, switches and ties. The two kinds of network meet at substations like Metro’s, where transformers, breakers and buses turn
        transmission into distribution. In the next lesson we’ll open one up.
      </P>
    </LessonPage>
  );
}

